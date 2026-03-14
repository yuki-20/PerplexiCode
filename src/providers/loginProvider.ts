import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ChromeCookieReader } from '../api/cookieReader';

/**
 * Three login strategies:
 *
 * 1. **Import from Browser** — Reads cookies directly from the user's
 *    installed Chrome/Edge/Brave. Zero interaction if already logged in.
 *
 * 2. **Stealth Puppeteer** — Opens Chrome with anti-detection flags.
 *
 * 3. **Manual Paste** — User copies cookies from DevTools.
 */
export class LoginProvider {
  private cookieReader = new ChromeCookieReader();

  async login(): Promise<{ sessionToken: string; csrfToken: string; fullCookies?: string } | null> {
    const method = await vscode.window.showQuickPick(
      [
        {
          label: '$(key) Import from Browser (recommended)',
          description: 'Instantly reads session from your Chrome / Edge / Brave',
          method: 'import',
        },
        {
          label: '$(browser) Auto Login (opens Chrome)',
          description: 'Opens a new browser window for login',
          method: 'auto',
        },
        {
          label: '$(edit) Manual Paste (DevTools)',
          description: 'Copy cookies from DevTools → Application → Cookies',
          method: 'manual',
        },
      ],
      {
        title: 'PerplexiCode: Choose Login Method',
        placeHolder: 'If already logged in to Perplexity, "Import from Browser" is the easiest',
      }
    );

    if (!method) { return null; }

    switch (method.method) {
      case 'import':
        return this._importFromBrowser();
      case 'auto': {
        const result = await this._autoLogin();
        if (result) { return result; }
        const retry = await vscode.window.showWarningMessage(
          'Auto login failed. Try another method?',
          'Import from Browser',
          'Manual Paste',
          'Cancel'
        );
        if (retry === 'Import from Browser') { return this._importFromBrowser(); }
        if (retry === 'Manual Paste') { return this._manualLogin(); }
        return null;
      }
      case 'manual':
        return this._manualLogin();
      default:
        return null;
    }
  }

  // ══════════════════════════════════════════
  // Strategy 1: Import from Browser (requires browser to be closed)
  // ══════════════════════════════════════════
  private async _importFromBrowser(): Promise<{ sessionToken: string; csrfToken: string } | null> {
    // Check if browser is running (it holds exclusive locks on cookies)
    if (this.cookieReader.isBrowserRunning()) {
      const action = await vscode.window.showWarningMessage(
        'PerplexiCode needs to read cookies from Chrome/Edge, but the browser is currently running and locks the cookie file.\n\nPlease close ALL Chrome and Edge windows first.',
        { modal: true, detail: 'Steps:\n1. Make sure you are logged in to perplexity.ai\n2. Close ALL Chrome/Edge windows\n3. Click "Try Import" below\n\nDon\'t worry — you can reopen your browser right after!' },
        'Try Import',
        'Use Manual Paste Instead'
      );

      if (action === 'Use Manual Paste Instead') {
        return this._manualLogin();
      }
      if (!action) { return null; }

      // Check again after user says they closed it
      if (this.cookieReader.isBrowserRunning()) {
        const retry = await vscode.window.showWarningMessage(
          'Chrome or Edge is still running. Please close all browser windows and try again.',
          'Try Again',
          'Use Manual Paste',
          'Cancel'
        );
        if (retry === 'Try Again') {
          // One more check
          if (this.cookieReader.isBrowserRunning()) {
            vscode.window.showErrorMessage('PerplexiCode: Browser still running. Using manual paste instead.');
            return this._manualLogin();
          }
        } else if (retry === 'Use Manual Paste') {
          return this._manualLogin();
        } else {
          return null;
        }
      }
    }

    // Browser should be closed now — try reading cookies
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'PerplexiCode',
      },
      async (progress) => {
        progress.report({ message: 'Reading cookies from browser database...' });

        const result = await this.cookieReader.getPerplexityCookies();

        if (result) {
          vscode.window.showInformationMessage('PerplexiCode: Session imported from your browser! ✓ You can reopen your browser now.');
          return result;
        }

        // Not found
        const action = await vscode.window.showWarningMessage(
          'No Perplexity session found. Make sure you were logged in to perplexity.ai before closing the browser.',
          'Use Manual Paste',
          'Cancel'
        );

        if (action === 'Use Manual Paste') {
          return this._manualLogin();
        }
        return null;
      }
    );
  }

  // ══════════════════════════════════════════
  // Strategy 1: Stealth Puppeteer
  // ══════════════════════════════════════════
  private async _autoLogin(): Promise<{ sessionToken: string; csrfToken: string } | null> {
    let puppeteer: typeof import('puppeteer-core');
    try {
      puppeteer = require('puppeteer-core');
    } catch {
      vscode.window.showErrorMessage('PerplexiCode: Browser automation module not available.');
      return null;
    }

    const browserPath = this._detectBrowserPath();
    if (!browserPath) {
      vscode.window.showErrorMessage(
        'PerplexiCode: Could not find Chrome or Edge. Please install Google Chrome or Microsoft Edge.'
      );
      return null;
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'PerplexiCode',
        cancellable: true,
      },
      async (progress, token) => {
        progress.report({ message: 'Opening browser for Perplexity login...' });

        let browser: any = null;
        try {
          browser = await puppeteer.launch({
            executablePath: browserPath,
            headless: false,
            defaultViewport: null, // Use window size as viewport
            ignoreDefaultArgs: [
              '--enable-automation',         // Remove "controlled by automation" banner
              '--enable-blink-features=IdleDetection',
            ],
            args: [
              '--no-first-run',
              '--no-default-browser-check',
              '--disable-blink-features=AutomationControlled',  // Key anti-detection flag
              '--disable-infobars',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--window-size=1100,750',
              '--start-maximized',
            ],
          });

          const pages = await browser.pages();
          const page = pages[0] || await browser.newPage();

          // ── Stealth patches (injected as string to avoid TS browser-global errors) ──
          await page.evaluateOnNewDocument(`
            // Remove webdriver property
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

            // Add Chrome runtime object
            window.chrome = {
              runtime: {},
              loadTimes: function(){},
              csi: function(){},
              app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, runningState: function(){ return 'cannot_run'; } },
            };

            // Override permissions query
            var origQuery = navigator.permissions.query.bind(navigator.permissions);
            Object.defineProperty(navigator.permissions, 'query', {
              value: function(params) {
                return params.name === 'notifications'
                  ? Promise.resolve({ state: Notification.permission })
                  : origQuery(params);
              },
            });

            // Override plugins
            Object.defineProperty(navigator, 'plugins', {
              get: function() {
                var plugins = [
                  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                plugins.item = function(i) { return plugins[i]; };
                plugins.namedItem = function(name) { return plugins.find(function(p){ return p.name === name; }); };
                plugins.refresh = function() {};
                return plugins;
              },
            });

            // Override languages, connection, hardware
            Object.defineProperty(navigator, 'languages', { get: function(){ return ['en-US', 'en']; } });
            Object.defineProperty(navigator, 'connection', { get: function(){ return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }; } });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: function(){ return 8; } });
            Object.defineProperty(navigator, 'deviceMemory', { get: function(){ return 8; } });

            // WebGL vendor/renderer overrides
            var origGetParam = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(param) {
              if (param === 37445) return 'Intel Inc.';
              if (param === 37446) return 'Intel Iris OpenGL Engine';
              return origGetParam.call(this, param);
            };
          `);

          // Set a realistic user agent
          await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          );

          // Set extra HTTP headers
          await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
          });

          // Navigate to Perplexity
          progress.report({ message: 'Navigating to Perplexity — please log in...' });
          await page.goto('https://www.perplexity.ai', {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });

          // Wait for session cookies
          const result = await this._waitForSession(page, browser, token, progress);

          if (browser.isConnected()) {
            await browser.close().catch(() => {});
          }

          return result;
        } catch (err: any) {
          if (browser && browser.isConnected()) {
            await browser.close().catch(() => {});
          }
          if (token.isCancellationRequested) { return null; }
          if (err.message?.includes('Target closed') || err.message?.includes('Protocol error')) {
            return null;
          }
          console.error('PerplexiCode auto-login error:', err);
          return null;
        }
      }
    );
  }

  private async _waitForSession(
    page: any,
    browser: any,
    cancellation: vscode.CancellationToken,
    progress: vscode.Progress<{ message?: string }>
  ): Promise<{ sessionToken: string; csrfToken: string } | null> {
    const maxWaitMs = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 2000;
    const startTime = Date.now();

    return new Promise((resolve) => {
      let resolved = false;
      const cleanup = () => { clearInterval(timer); };

      browser.on('disconnected', () => {
        if (!resolved) { resolved = true; cleanup(); resolve(null); }
      });
      cancellation.onCancellationRequested(() => {
        if (!resolved) { resolved = true; cleanup(); resolve(null); }
      });

      const timer = setInterval(async () => {
        if (resolved) { cleanup(); return; }
        if (Date.now() - startTime > maxWaitMs) {
          resolved = true; cleanup();
          vscode.window.showWarningMessage('PerplexiCode: Login timed out after 5 minutes.');
          resolve(null);
          return;
        }
        try {
          if (!browser.isConnected()) {
            resolved = true; cleanup(); resolve(null); return;
          }
          const client = await page.createCDPSession();
          const { cookies } = await client.send('Network.getAllCookies');
          await client.detach().catch(() => {});

          const session = cookies.find(
            (c: any) => c.name === '__Secure-next-auth.session-token' && c.domain.includes('perplexity.ai')
          );
          const csrf = cookies.find(
            (c: any) => c.name === 'next-auth.csrf-token' && c.domain.includes('perplexity.ai')
          );

          if (session && csrf) {
            progress.report({ message: 'Login detected! Capturing session...' });
            resolved = true; cleanup();
            resolve({ sessionToken: session.value, csrfToken: csrf.value });
          }
        } catch {
          // Page navigating or browser closed
        }
      }, pollInterval);
    });
  }

  // ══════════════════════════════════════════
  // Strategy 2: Manual Paste via VS Code UI
  // ══════════════════════════════════════════
  private async _manualLogin(): Promise<{ sessionToken: string; csrfToken: string; fullCookies?: string } | null> {
    const openBrowser = await vscode.window.showInformationMessage(
      'PerplexiCode: Paste your full Cookie header',
      {
        modal: true,
        detail:
          '1. Open perplexity.ai (make sure you\'re logged in)\n' +
          '2. Press F12 → Network tab\n' +
          '3. Check "Disable cache" at the top\n' +
          '4. Refresh the page (F5)\n' +
          '5. Click the FIRST request (www.perplexity.ai)\n' +
          '6. Find Request Headers → Cookie:\n' +
          '7. Right-click the value → Copy value\n' +
          '8. Paste it here (the FULL string)',
      },
      'Open Perplexity & Continue',
      'I already have it'
    );

    if (!openBrowser) { return null; }

    if (openBrowser === 'Open Perplexity & Continue') {
      await vscode.env.openExternal(vscode.Uri.parse('https://www.perplexity.ai'));
      await new Promise((r) => setTimeout(r, 1500));
    }

    const input = await vscode.window.showInputBox({
      title: 'PerplexiCode — Paste Full Cookie Header',
      prompt: 'Paste the ENTIRE Cookie value from Network tab → Request Headers. It\'s a long string with multiple key=value pairs.',
      placeHolder: 'pplx.visitor-id=...; __Secure-next-auth.session-token=eyJ...; cf_clearance=...',
      ignoreFocusOut: true,
    });

    if (!input || !input.trim()) {
      vscode.window.showWarningMessage('PerplexiCode: Login cancelled.');
      return null;
    }

    const fullCookies = input.trim();

    // Extract session token from the full cookie string
    const sessionMatch = fullCookies.match(/__Secure-next-auth\.session-token=([^;]+)/);
    if (!sessionMatch) {
      // Maybe user pasted just the session token
      if (fullCookies.startsWith('eyJ')) {
        return { sessionToken: fullCookies, csrfToken: 'placeholder' };
      }
      vscode.window.showErrorMessage('PerplexiCode: Could not find session token in the pasted string. Make sure you copied the full Cookie header.');
      return null;
    }

    const sessionToken = sessionMatch[1].trim();

    // Extract CSRF if present
    const csrfMatch = fullCookies.match(/next-auth\.csrf-token=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1].trim() : 'placeholder';

    return { sessionToken, csrfToken, fullCookies };
  }

  // ══════════════════════════════════════════
  // Browser Detection
  // ══════════════════════════════════════════
  private _detectBrowserPath(): string | null {
    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    const candidates: string[] = [];

    if (isWin) {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pfx = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      const la = process.env['LOCALAPPDATA'] || '';
      candidates.push(
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(la, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        path.join(la, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      );
    } else if (isMac) {
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      );
    } else {
      candidates.push(
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium', '/usr/bin/chromium-browser',
        '/usr/bin/microsoft-edge', '/usr/bin/brave-browser',
      );
    }

    for (const c of candidates) {
      try { if (fs.existsSync(c)) { return c; } } catch { continue; }
    }
    return null;
  }
}
