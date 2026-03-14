import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

/**
 * Reads cookies directly from Chrome/Edge SQLite database.
 *
 * IMPORTANT: The browser must NOT be running when reading cookies,
 * because Chrome/Edge hold exclusive locks on the Cookies file.
 * The caller should prompt the user to close their browser first.
 */
export class ChromeCookieReader {

  /**
   * Check if browsers are running (blocking cookie access).
   */
  isBrowserRunning(): boolean {
    if (process.platform !== 'win32') { return false; }
    try {
      const result = execSync(
        'tasklist /FI "IMAGENAME eq chrome.exe" /NH & tasklist /FI "IMAGENAME eq msedge.exe" /NH',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true, stdio: 'pipe' }
      );
      return result.includes('chrome.exe') || result.includes('msedge.exe');
    } catch { return false; }
  }

  /**
   * Extract Perplexity cookies. Browser must be closed first.
   */
  async getPerplexityCookies(): Promise<{ sessionToken: string; csrfToken: string } | null> {
    const browsers = this._getBrowserPaths();

    for (const browser of browsers) {
      try {
        const result = await this._readCookiesFrom(browser.userDataDir, browser.name);
        if (result) { return result; }
      } catch (err) {
        console.log(`PerplexiCode: Could not read cookies from ${browser.name}:`, err);
        continue;
      }
    }

    return null;
  }

  private async _readCookiesFrom(
    userDataDir: string,
    browserName: string
  ): Promise<{ sessionToken: string; csrfToken: string } | null> {
    // Step 1: Get master key
    const localStatePath = path.join(userDataDir, 'Local State');
    if (!fs.existsSync(localStatePath)) { return null; }

    const localState = JSON.parse(fs.readFileSync(localStatePath, 'utf-8'));
    const encryptedKeyB64 = localState?.os_crypt?.encrypted_key;
    if (!encryptedKeyB64) { return null; }

    const encryptedKeyBuf = Buffer.from(encryptedKeyB64, 'base64');
    const dpapiBlob = encryptedKeyBuf.slice(5); // Strip "DPAPI" prefix

    const masterKey = this._decryptDPAPI(dpapiBlob);
    if (!masterKey) { return null; }

    // Step 2: Find and read Cookies database
    const profiles = ['Default', 'Profile 1', 'Profile 2', 'Profile 3'];

    for (const profile of profiles) {
      const cookiePaths = [
        path.join(userDataDir, profile, 'Network', 'Cookies'),
        path.join(userDataDir, profile, 'Cookies'),
      ];

      for (const cookiePath of cookiePaths) {
        if (!fs.existsSync(cookiePath)) { continue; }

        try {
          const result = await this._extractFromSQLite(cookiePath, masterKey);
          if (result) {
            console.log(`PerplexiCode: Found Perplexity cookies in ${browserName} (${profile})`);
            return result;
          }
        } catch (e) {
          console.log(`PerplexiCode: SQLite read error for ${browserName}/${profile}:`, e);
          continue;
        }
      }
    }

    return null;
  }

  private async _extractFromSQLite(
    cookiePath: string,
    masterKey: Buffer
  ): Promise<{ sessionToken: string; csrfToken: string } | null> {
    const tempPath = path.join(
      process.env['TEMP'] || process.env['TMP'] || '/tmp',
      `perplexicode_cookies_${Date.now()}.db`
    );

    // Copy the database (browser must be closed!)
    try {
      fs.copyFileSync(cookiePath, tempPath);
    } catch (e: any) {
      console.log('PerplexiCode: Cannot copy cookies file (browser still running?):', e.code);
      return null;
    }

    let sessionToken: string | null = null;
    let csrfToken: string | null = null;

    try {
      const initSqlJs = require('sql.js');
      const SQL = await initSqlJs();

      const dbBuffer = fs.readFileSync(tempPath);
      const db = new SQL.Database(dbBuffer);

      const stmt = db.prepare(`
        SELECT name, encrypted_value, value
        FROM cookies
        WHERE host_key LIKE '%perplexity.ai%'
          AND (name = '__Secure-next-auth.session-token' OR name = 'next-auth.csrf-token')
      `);

      while (stmt.step()) {
        const row = stmt.getAsObject() as { name: string; encrypted_value: Uint8Array; value: string };
        let cookieValue = '';

        if (row.encrypted_value && row.encrypted_value.length > 0) {
          const encBuf = Buffer.from(row.encrypted_value);
          cookieValue = this._decryptCookieValue(encBuf, masterKey) || '';
        }
        if (!cookieValue && row.value) {
          cookieValue = row.value;
        }

        if (row.name === '__Secure-next-auth.session-token' && cookieValue) {
          sessionToken = cookieValue;
        }
        if (row.name === 'next-auth.csrf-token' && cookieValue) {
          csrfToken = cookieValue;
        }
      }

      stmt.free();
      db.close();
    } finally {
      try { fs.unlinkSync(tempPath); } catch {}
    }

    if (sessionToken && csrfToken) {
      return { sessionToken, csrfToken };
    }
    return null;
  }

  private _decryptCookieValue(encryptedValue: Buffer, masterKey: Buffer): string | null {
    try {
      const prefix = encryptedValue.slice(0, 3).toString('ascii');

      if (prefix === 'v10' || prefix === 'v20') {
        const nonce = encryptedValue.slice(3, 15);
        const ciphertext = encryptedValue.slice(15, encryptedValue.length - 16);
        const authTag = encryptedValue.slice(encryptedValue.length - 16);

        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf-8');
      }
      return null;
    } catch { return null; }
  }

  private _decryptDPAPI(dpapiBlob: Buffer): Buffer | null {
    if (process.platform !== 'win32') { return null; }

    try {
      const b64 = dpapiBlob.toString('base64');
      const psScript = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String('${b64}'); $d=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'); [Convert]::ToBase64String($d)`;
      const result = execSync(
        `powershell -NoProfile -Command "${psScript}"`,
        { encoding: 'utf-8', timeout: 10000, windowsHide: true, stdio: 'pipe' }
      );
      return Buffer.from(result.trim(), 'base64');
    } catch (err) {
      console.error('PerplexiCode: DPAPI decryption failed:', err);
      return null;
    }
  }

  private _getBrowserPaths(): { name: string; userDataDir: string }[] {
    const results: { name: string; userDataDir: string }[] = [];
    const la = process.env['LOCALAPPDATA'] || '';

    if (process.platform === 'win32' && la) {
      const browsers = [
        { name: 'Chrome', dir: path.join(la, 'Google', 'Chrome', 'User Data') },
        { name: 'Edge', dir: path.join(la, 'Microsoft', 'Edge', 'User Data') },
        { name: 'Brave', dir: path.join(la, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      ];
      for (const b of browsers) {
        if (fs.existsSync(b.dir)) { results.push({ name: b.name, userDataDir: b.dir }); }
      }
    }

    return results;
  }
}
