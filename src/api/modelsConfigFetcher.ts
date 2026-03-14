import * as fs from 'fs';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import {
  AccountSession,
  PerplexityModelConfigEntry,
  PerplexityModelDefinition,
  PerplexityModelsConfigSnapshot,
  PerplexitySearchMode,
} from './types';

const PERPLEXITY_HOST = 'www.perplexity.ai';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const CONFIG_PATH = '/rest/models/config?config_schema=v1&version=2.18&source=default';

/**
 * Fetches the authenticated model config from Perplexity's web app using a real browser context.
 * Cloudflare blocks the raw Node HTTPS path for this endpoint, so we mirror the web client here.
 */
export class ModelsConfigFetcher {
  async fetch(account: AccountSession): Promise<PerplexityModelsConfigSnapshot | undefined> {
    // Try direct HTTPS first (works when Cloudflare doesn't challenge)
    const direct = await this.fetchDirect(account).catch(() => undefined);
    if (direct) {
      return direct;
    }

    // Fall back to browser-based fetch for Cloudflare-protected endpoints
    return this._fetchViaBrowser(account).catch(() => undefined);
  }

  async fetchDirect(account: AccountSession): Promise<PerplexityModelsConfigSnapshot | undefined> {
    const cookie = account.fullCookies
      ? account.fullCookies
      : `__Secure-next-auth.session-token=${account.sessionToken}; next-auth.csrf-token=${account.csrfToken}`;

    const body = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          method: 'GET',
          hostname: PERPLEXITY_HOST,
          path: CONFIG_PATH,
          headers: {
            'Accept': 'application/json',
            'Cookie': cookie,
            'Referer': 'https://www.perplexity.ai/',
            'Origin': 'https://www.perplexity.ai',
            'User-Agent': USER_AGENT,
          },
          timeout: 20_000,
        },
        (res) => {
          // Cloudflare challenge or auth failure — fall through to browser path
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`Models config returned ${res.statusCode || 0}`));
            res.resume();
            return;
          }

          let data = '';
          res.on('data', (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error('Models config fetch timed out'));
      });
      req.end();
    });

    try {
      const parsed = JSON.parse(body);
      return normalizeModelsConfigPayload(parsed);
    } catch {
      return undefined;
    }
  }

  private async _fetchViaBrowser(account: AccountSession): Promise<PerplexityModelsConfigSnapshot | undefined> {
    const browserPath = this._detectBrowserPath();
    if (!browserPath) {
      return undefined;
    }

    const cookies = this._toBrowserCookies(account);
    if (cookies.length === 0) {
      return undefined;
    }

    let puppeteer: typeof import('puppeteer-core');
    try {
      puppeteer = require('puppeteer-core');
    } catch {
      return undefined;
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perplexicode-models-'));
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;

    try {
      browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: false,
        userDataDir,
        defaultViewport: { width: 1280, height: 800 },
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-blink-features=AutomationControlled',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--window-position=-2400,0',
          '--window-size=1280,800',
        ],
      });

      const page = await browser.newPage();
      await page.evaluateOnNewDocument(`
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        window.chrome = { runtime: {} };
      `);
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.goto('https://www.perplexity.ai/', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await page.setCookie(...cookies);
      await page.goto('https://www.perplexity.ai/', {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });

      const payload = await page.evaluate(async () => {
        const response = await fetch('/rest/models/config?config_schema=v1&version=2.18&source=default', {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Perplexity models config returned ${response.status}`);
        }
        return response.json();
      });

      return normalizeModelsConfigPayload(payload);
    } catch {
      return undefined;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }

  private _detectBrowserPath(): string | undefined {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const la = process.env['LOCALAPPDATA'] || '';
    const candidates = [
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(la, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];

    return candidates.find((candidate) => fs.existsSync(candidate));
  }

  private _toBrowserCookies(account: AccountSession): Array<{ name: string; value: string; url: string }> {
    const cookiePairs = account.fullCookies
      ? parseCookieHeader(account.fullCookies)
      : [
        { name: '__Secure-next-auth.session-token', value: account.sessionToken },
        { name: 'next-auth.csrf-token', value: account.csrfToken },
      ];

    return cookiePairs
      .filter((cookie) => cookie.name && cookie.value)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: 'https://www.perplexity.ai/',
      }));
  }
}

export function normalizeModelsConfigPayload(value: unknown): PerplexityModelsConfigSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const models = normalizeModelsRecord(record.models);
  const config = normalizeConfigEntries(record.config);

  if (Object.keys(models).length === 0 && config.length === 0) {
    return undefined;
  }

  const defaultModels = normalizeDefaultModels(record.default_models);
  const agenticResearchCompareModels = Array.isArray(record.agentic_research_compare_models)
    ? record.agentic_research_compare_models.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : undefined;

  return {
    fetchedAt: new Date().toISOString(),
    config_schema: typeof record.config_schema === 'string' ? record.config_schema : undefined,
    models,
    config,
    default_models: defaultModels,
    agentic_research_compare_models: agenticResearchCompareModels,
  };
}

function normalizeModelsRecord(value: unknown): Record<string, PerplexityModelDefinition> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const models: Record<string, PerplexityModelDefinition> = {};
  for (const [rawId, rawModel] of Object.entries(value)) {
    if (typeof rawId !== 'string' || !rawId.trim()) {
      continue;
    }
    if (!rawModel || typeof rawModel !== 'object' || Array.isArray(rawModel)) {
      continue;
    }

    const model = rawModel as Record<string, unknown>;
    const mode = normalizeSearchMode(model.mode);
    const label = typeof model.label === 'string' ? model.label.trim() : rawId.trim();
    if (!mode || !label) {
      continue;
    }

    models[rawId.trim()] = {
      label,
      description: typeof model.description === 'string' ? model.description.trim() : undefined,
      mode,
      provider: typeof model.provider === 'string' ? model.provider.trim() : null,
    };
  }

  return models;
}

function normalizeConfigEntries(value: unknown): PerplexityModelConfigEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.label !== 'string' || !record.label.trim()) {
      return [];
    }

    return [{
      label: record.label.trim(),
      description: typeof record.description === 'string' ? record.description.trim() : undefined,
      subheading: typeof record.subheading === 'string' ? record.subheading.trim() : undefined,
      has_new_tag: record.has_new_tag === true,
      subscription_tier: typeof record.subscription_tier === 'string' ? record.subscription_tier.trim() : undefined,
      non_reasoning_model: typeof record.non_reasoning_model === 'string' ? record.non_reasoning_model.trim() : undefined,
      reasoning_model: typeof record.reasoning_model === 'string' ? record.reasoning_model.trim() : undefined,
      text_only_model: record.text_only_model === true,
    }];
  });
}

function normalizeDefaultModels(value: unknown): Partial<Record<PerplexitySearchMode, string>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const normalized: Partial<Record<PerplexitySearchMode, string>> = {};
  for (const [mode, modelId] of Object.entries(value)) {
    const normalizedMode = normalizeSearchMode(mode);
    if (!normalizedMode || typeof modelId !== 'string' || !modelId.trim()) {
      continue;
    }
    normalized[normalizedMode] = modelId.trim();
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeSearchMode(value: unknown): PerplexitySearchMode | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  switch (value.trim()) {
    case 'search':
    case 'research':
    case 'agentic_research':
    case 'studio':
    case 'study':
    case 'document_review':
    case 'browser_agent':
    case 'asi':
      return value.trim() as PerplexitySearchMode;
    default:
      return undefined;
  }
}

function parseCookieHeader(value: string): Array<{ name: string; value: string }> {
  return value.split(/;\s*/).flatMap((entry) => {
    const separatorIndex = entry.indexOf('=');
    if (separatorIndex === -1) {
      return [];
    }

    const name = entry.slice(0, separatorIndex).trim();
    const cookieValue = entry.slice(separatorIndex + 1).trim();
    if (!name || !cookieValue) {
      return [];
    }

    return [{ name, value: cookieValue }];
  });
}
