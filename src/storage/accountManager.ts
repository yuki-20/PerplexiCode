import * as vscode from 'vscode';
import { AccountSession, AccountMeta } from '../api/types';
import { PerplexityWebClient } from '../api/perplexityClient';

const ACCOUNTS_META_KEY = 'perplexicode.accounts';
const SESSION_KEY_PREFIX = 'perplexicode.session.';
const CSRF_KEY_PREFIX = 'perplexicode.csrf.';
const COOKIES_KEY_PREFIX = 'perplexicode.cookies.';

/**
 * Manages multiple Perplexity account sessions.
 * Metadata stored in globalState; tokens encrypted in SecretStorage.
 */
export class AccountManager {
  private globalState: vscode.Memento;
  private secretStorage: vscode.SecretStorage;
  private accounts: AccountSession[] = [];

  constructor(globalState: vscode.Memento, secretStorage: vscode.SecretStorage) {
    this.globalState = globalState;
    this.secretStorage = secretStorage;
  }

  /**
   * Load accounts from storage into memory.
   */
  async initialize(): Promise<void> {
    const metas = this.globalState.get<AccountMeta[]>(ACCOUNTS_META_KEY, []);
    this.accounts = [];

    for (const meta of metas) {
      const sessionToken = await this.secretStorage.get(SESSION_KEY_PREFIX + meta.id);
      const csrfToken = await this.secretStorage.get(CSRF_KEY_PREFIX + meta.id);
      const fullCookies = await this.secretStorage.get(COOKIES_KEY_PREFIX + meta.id);

      if (sessionToken && csrfToken) {
        // Auto-recover accounts stuck in error/expired state
        if (meta.status === 'error' || meta.status === 'expired') {
          meta.status = 'active';
          meta.errorCount = 0;
          meta.cooldownUntil = undefined;
        }
        
        this.accounts.push({
          ...meta,
          sessionToken,
          csrfToken,
          fullCookies: fullCookies || undefined,
        });
      }
    }
  }

  /**
   * Add an account with captured session tokens.
   * Auto-fetches CSRF if missing. Stores tokens without upfront validation
   * (validation happens lazily on first query to avoid Cloudflare blocks).
   */
  async addAccount(
    alias: string,
    sessionToken: string,
    csrfToken: string,
    options?: { color?: string; fullCookies?: string }
  ): Promise<{ success: boolean; error?: string; account?: AccountSession }> {
    if (!sessionToken) {
      return { success: false, error: 'Session token is required.' };
    }

    // Auto-fetch CSRF token if not provided
    if (!csrfToken || csrfToken === 'placeholder') {
      const fetchedCsrf = await this._fetchCsrfToken(sessionToken);
      if (fetchedCsrf) {
        csrfToken = fetchedCsrf;
      } else {
        // Use a placeholder - CSRF will be fetched on demand
        csrfToken = 'auto';
      }
    }

    const id = this._generateId();
    const account: AccountSession = {
      id,
      alias: alias || `Account ${this.accounts.length + 1}`,
      sessionToken,
      csrfToken,
      fullCookies: options?.fullCookies,
      status: 'active',
      addedAt: new Date().toISOString(),
      queriestoday: 0,
      queriesTotalLifetime: 0,
      errorCount: 0,
      color: options?.color,
      capabilities: undefined,
      quotas: undefined,
    };

    this.accounts.push(account);

    // Persist tokens in SecretStorage
    await this.secretStorage.store(SESSION_KEY_PREFIX + id, sessionToken);
    await this.secretStorage.store(CSRF_KEY_PREFIX + id, csrfToken);
    if (options?.fullCookies) {
      await this.secretStorage.store(COOKIES_KEY_PREFIX + id, options.fullCookies);
    }

    // Persist metadata
    await this._saveMetas();

    return { success: true, account };
  }

  /**
   * Remove an account by ID.
   */
  async removeAccount(id: string): Promise<void> {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    await this.secretStorage.delete(SESSION_KEY_PREFIX + id);
    await this.secretStorage.delete(CSRF_KEY_PREFIX + id);
    await this.secretStorage.delete(COOKIES_KEY_PREFIX + id);
    await this._saveMetas();
  }

  /**
   * Update account tokens (after re-login).
   */
  async updateTokens(id: string, sessionToken: string, csrfToken: string, fullCookies?: string): Promise<boolean> {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) { return false; }

    account.sessionToken = sessionToken;
    account.csrfToken = csrfToken;
    account.fullCookies = fullCookies || undefined;
    account.status = 'active';
    account.errorCount = 0;
    account.cooldownUntil = undefined;
    // Clear stale blocked model IDs on token refresh
    if (account.capabilities) {
      account.capabilities.blockedModelIds = undefined;
    }

    await this.secretStorage.store(SESSION_KEY_PREFIX + id, sessionToken);
    await this.secretStorage.store(CSRF_KEY_PREFIX + id, csrfToken);
    if (fullCookies) {
      await this.secretStorage.store(COOKIES_KEY_PREFIX + id, fullCookies);
    }
    await this._saveMetas();

    return true;
  }

  /**
   * Toggle an account's enabled/disabled state.
   */
  async toggleAccount(id: string): Promise<void> {
    const account = this.accounts.find((a) => a.id === id);
    if (account) {
      account.status = account.status === 'disabled' ? 'active' : 'disabled';
      await this._saveMetas();
    }
  }

  /**
   * Get all accounts.
   */
  getAccounts(): AccountSession[] {
    return [...this.accounts];
  }

  /**
   * Get the count of active accounts.
   */
  getActiveCount(): number {
    return this.accounts.filter((a) => a.status === 'active' || a.status === 'rate_limited').length;
  }

  /**
   * Check if there are any accounts configured.
   */
  hasAccounts(): boolean {
    return this.accounts.length > 0;
  }

  /**
   * Persist account metadata to globalState.
   */
  async saveMetas(): Promise<void> {
    await this._saveMetas();
  }

  private async _saveMetas(): Promise<void> {
    const metas: AccountMeta[] = this.accounts.map((a) => ({
      id: a.id,
      alias: a.alias,
      status: a.status,
      addedAt: a.addedAt,
      lastUsedAt: a.lastUsedAt,
      queriestoday: a.queriestoday,
      queriesTotalLifetime: a.queriesTotalLifetime,
      cooldownUntil: a.cooldownUntil,
      errorCount: a.errorCount,
      color: a.color,
      capabilities: a.capabilities,
      quotas: a.quotas,
    }));

    await this.globalState.update(ACCOUNTS_META_KEY, metas);
  }

  private _generateId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Fetch CSRF token from Perplexity's /api/auth/csrf endpoint.
   * Captures the full cookie value (token|hash) from Set-Cookie header.
   */
  private _fetchCsrfToken(sessionToken: string): Promise<string | null> {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.request({
        hostname: 'www.perplexity.ai',
        path: '/api/auth/csrf',
        method: 'GET',
        headers: {
          'Cookie': `__Secure-next-auth.session-token=${sessionToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      }, (res: any) => {
        let body = '';
        res.on('data', (d: Buffer) => body += d);
        res.on('end', () => {
          // First try: get full CSRF cookie from Set-Cookie header
          const setCookies: string[] = res.headers['set-cookie'] || [];
          for (const cookie of setCookies) {
            const match = cookie.match(/next-auth\.csrf-token=([^;]+)/);
            if (match) {
              // URL-decode the value (%7C → |)
              const fullValue = decodeURIComponent(match[1]);
              resolve(fullValue);
              return;
            }
          }

          // Fallback: use the JSON body csrfToken
          try {
            const data = JSON.parse(body);
            if (data.csrfToken) {
              resolve(data.csrfToken);
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
      req.end();
    });
  }
}
