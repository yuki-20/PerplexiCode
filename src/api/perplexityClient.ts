import * as https from 'https';
import * as tls from 'tls';
import { getModelById, getModelLabel } from './modelCatalog';
import {
  QueryRequestOptions,
  StreamCallbacks,
  StreamResponseMeta,
} from './types';

const PERPLEXITY_HOST = 'www.perplexity.ai';
const API_VERSION = '2.18';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const MAX_RETRIES = 2;

// Chrome-like TLS cipher suite ordering to avoid Cloudflare JA3 fingerprint detection
const CHROME_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA',
].join(':');

const chromeAgent = new https.Agent({
  keepAlive: true,
  ciphers: CHROME_CIPHERS,
  minVersion: 'TLSv1.2' as tls.SecureVersion,
  maxVersion: 'TLSv1.3' as tls.SecureVersion,
});

/**
 * Perplexity web client using the browser session cookies and the web SSE API.
 */
export class PerplexityWebClient {
  constructor(
    private sessionToken: string,
    private csrfToken: string,
    private fullCookies?: string
  ) {}

  updateTokens(sessionToken: string, csrfToken: string, fullCookies?: string): void {
    this.sessionToken = sessionToken;
    this.csrfToken = csrfToken;
    this.fullCookies = fullCookies;
  }

  streamQuery(
    query: string,
    requestedModel: string,
    callbacks: StreamCallbacks,
    options?: QueryRequestOptions
  ): AbortController {
    const abortController = new AbortController();
    const meta = this._buildInitialMeta(requestedModel, options);
    this._doRequest(query, meta, callbacks, options, abortController, 0);
    return abortController;
  }

  async query(
    query: string,
    model: string,
    options?: QueryRequestOptions
  ): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      let fullText = '';
      this.streamQuery(query, model, {
        onChunk: (content) => {
          fullText += content;
        },
        onDone: (content) => {
          resolve({ text: fullText || content });
        },
        onError: reject,
      }, options);
    });
  }

  async validateSession(): Promise<boolean> {
    return new Promise((resolve) => {
      const req = https.request(
        {
          method: 'GET',
          hostname: PERPLEXITY_HOST,
          path: '/api/auth/session',
          agent: chromeAgent,
          headers: {
            'Accept': 'application/json',
            'Cookie': this._buildCookie(),
            'User-Agent': USER_AGENT,
          },
          timeout: 15_000,
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          res.on('end', () => {
            if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 400) {
              resolve(false);
              return;
            }

            resolve(body.trim() !== '{}' && body.trim().length > 0);
          });
        }
      );

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  private _doRequest(
    query: string,
    meta: StreamResponseMeta,
    callbacks: StreamCallbacks,
    options: QueryRequestOptions | undefined,
    abortController: AbortController,
    retryCount: number
  ): void {
    const sources = options?.sources ?? ['web'];
    const language = options?.language ?? 'en-US';
    const body = JSON.stringify({
      query_str: query,
      params: {
        attachments: [],
        frontend_context_uuid: this._uuid(),
        frontend_uuid: this._uuid(),
        is_incognito: false,
        language,
        last_backend_uuid: null,
        mode: meta.mode,
        model_preference: meta.resolvedModel,
        search_mode: meta.searchMode,
        source: 'default',
        sources,
        version: API_VERSION,
      },
    });

    const cookie = this._buildCookie();

    const req = https.request(
      {
        method: 'POST',
        hostname: PERPLEXITY_HOST,
        path: '/rest/sse/perplexity_ask',
        agent: chromeAgent,
        headers: {
          'Accept': 'text/event-stream',
          'Accept-Language': 'en-US,en;q=0.9',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Cookie': cookie,
          'Origin': 'https://www.perplexity.ai',
          'Referer': 'https://www.perplexity.ai/',
          'User-Agent': USER_AGENT,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        timeout: 60_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode !== 200) {
          let errorBody = '';
          res.on('data', (chunk: Buffer) => {
            errorBody += chunk.toString();
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 500 && retryCount < MAX_RETRIES) {
              const delay = Math.pow(2, retryCount) * 1000;
              setTimeout(() => {
                this._doRequest(query, meta, callbacks, options, abortController, retryCount + 1);
              }, delay);
              return;
            }

            callbacks.onError(this._toRequestError(res.statusCode || 0, errorBody));
          });
          return;
        }

        let fullContent = '';
        let responseMeta = { ...meta };
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          if (abortController.signal.aborted) {
            res.destroy();
            return;
          }

          buffer += chunk.toString();
          const events = buffer.split('\r\n\r\n');
          buffer = events.pop() || '';

          for (const event of events) {
            const trimmed = event.trim();
            if (!trimmed) {
              continue;
            }

            if (trimmed.includes('event: end_of_stream') || trimmed === 'data: [DONE]') {
              callbacks.onDone(fullContent, responseMeta);
              return;
            }

            const payload = this._extractEventPayload(trimmed);
            if (payload === undefined) {
              continue;
            }

            if (typeof payload === 'string') {
              fullContent += payload;
              callbacks.onChunk(payload);
              continue;
            }

            const processed = this._processChunk(payload, fullContent, responseMeta);
            fullContent = processed.content;
            responseMeta = processed.meta;

            if (processed.metaChanged) {
              callbacks.onMeta?.(processed.metaChanged);
            }
            if (processed.delta) {
              callbacks.onChunk(processed.delta);
            }
            if (processed.citations.length > 0) {
              callbacks.onCitations?.(processed.citations);
            }
          }
        });

        res.on('end', () => {
          if (abortController.signal.aborted) {
            return;
          }

          const payload = this._extractTrailingPayload(buffer);
          if (payload && typeof payload !== 'string') {
            const processed = this._processChunk(payload, fullContent, responseMeta);
            fullContent = processed.content;
            responseMeta = processed.meta;
            if (processed.metaChanged) {
              callbacks.onMeta?.(processed.metaChanged);
            }
            if (processed.delta) {
              callbacks.onChunk(processed.delta);
            }
            if (processed.citations.length > 0) {
              callbacks.onCitations?.(processed.citations);
            }
          }

          callbacks.onDone(fullContent, responseMeta);
        });

        res.on('error', (error: Error) => {
          callbacks.onError(error);
        });

        res.setTimeout(120_000, () => {
          res.destroy();
          callbacks.onError(new Error('Response timed out.'));
        });
      }
    );

    req.on('error', (error: Error) => {
      if (abortController.signal.aborted) {
        return;
      }

      if (retryCount < MAX_RETRIES) {
        const delay = Math.pow(2, retryCount) * 1000;
        setTimeout(() => {
          this._doRequest(query, meta, callbacks, options, abortController, retryCount + 1);
        }, delay);
        return;
      }

      callbacks.onError(new Error(`Connection failed: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      callbacks.onError(new Error('Connection timed out.'));
    });

    abortController.signal.addEventListener('abort', () => {
      req.destroy();
    });

    req.write(body);
    req.end();
  }

  private _buildInitialMeta(modelId: string, options?: QueryRequestOptions): StreamResponseMeta {
    const baseModel = getModelById(modelId);
    const resolvedModel = modelId;
    const searchMode = options?.searchMode || baseModel?.searchMode || 'search';
    const mode = options?.requestMode || baseModel?.requestMode || 'COPILOT';

    return {
      requestedModel: modelId,
      resolvedModel,
      displayModel: getModelLabel(resolvedModel),
      searchMode,
      mode,
    };
  }

  private _processChunk(
    data: any,
    currentContent: string,
    currentMeta: StreamResponseMeta
  ): {
    content: string;
    delta: string;
    citations: string[];
    meta: StreamResponseMeta;
    metaChanged?: Partial<StreamResponseMeta>;
  } {
    let content = currentContent;
    let delta = '';
    const citations = collectCitations(data);
    const nextMeta = { ...currentMeta };
    const metaChanged: Partial<StreamResponseMeta> = {};

    const displayModel = firstString(data?.display_model, data?.displayModel);
    const resolvedModel = firstString(data?.model_preference, data?.modelPreference);
    const searchMode = firstString(data?.search_mode, data?.searchMode);
    const mode = firstString(data?.mode);

    if (displayModel) {
      const label = getModelLabel(displayModel);
      if (label !== nextMeta.displayModel) {
        nextMeta.displayModel = label;
        metaChanged.displayModel = label;
      }
    }
    if (resolvedModel && resolvedModel !== nextMeta.resolvedModel) {
      nextMeta.resolvedModel = resolvedModel;
      metaChanged.resolvedModel = resolvedModel;
    }
    if (searchMode && searchMode !== nextMeta.searchMode) {
      nextMeta.searchMode = searchMode as StreamResponseMeta['searchMode'];
      metaChanged.searchMode = nextMeta.searchMode;
    }
    if (mode && mode.toUpperCase() !== nextMeta.mode) {
      nextMeta.mode = mode.toUpperCase() as StreamResponseMeta['mode'];
      metaChanged.mode = nextMeta.mode;
    }

    if (typeof data?.answer === 'string' && data.answer.length > content.length) {
      delta = data.answer.slice(content.length);
      content = data.answer;
    } else if (typeof data?.text === 'string') {
      const parsedText = extractTextFromPayload(data.text);
      if (parsedText.length > content.length) {
        delta = parsedText.slice(content.length);
        content = parsedText;
      }
    } else if (typeof data?.choices?.[0]?.delta?.content === 'string') {
      delta = data.choices[0].delta.content;
      content += delta;
    }

    return {
      content,
      delta,
      citations,
      meta: nextMeta,
      metaChanged: Object.keys(metaChanged).length > 0 ? metaChanged : undefined,
    };
  }

  private _extractEventPayload(event: string): any {
    if (event.includes('event: message')) {
      const match = event.match(/data:\s*(.*)/s);
      if (!match) {
        return undefined;
      }
      try {
        return JSON.parse(match[1].trim());
      } catch {
        return undefined;
      }
    }

    if (event.startsWith('data: ')) {
      const raw = event.slice(6).trim();
      if (!raw || raw === '[DONE]') {
        return undefined;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }

    return undefined;
  }

  private _extractTrailingPayload(buffer: string): any {
    const trimmed = buffer.trim();
    if (!trimmed || trimmed.includes('end_of_stream')) {
      return undefined;
    }
    if (trimmed.startsWith('data: ')) {
      const raw = trimmed.slice(6).trim();
      if (!raw || raw === '[DONE]') {
        return undefined;
      }
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private _toRequestError(statusCode: number, body: string): Error & { isAccessDenied?: boolean; isQuota?: boolean; isRateLimit?: boolean; isSession?: boolean; isCloudflare?: boolean } {
    const lowered = body.toLowerCase();
    if (statusCode === 401 || (statusCode === 403 && isAuthenticationFailure(lowered))) {
      const err = new Error('Session expired. Please re-login to your Perplexity account.') as any;
      err.isSession = true;
      return err;
    }
    if (statusCode === 403 && isCloudflareBlock(lowered)) {
      const err = new Error('Cloudflare is blocking this request. The extension needs to bypass Cloudflare protection.') as any;
      err.isCloudflare = true;
      return err;
    }
    if ((statusCode === 403 || statusCode === 429) && lowered.includes('quota')) {
      const err = new Error('Quota exhausted for this account.') as any;
      err.isQuota = true;
      return err;
    }
    if (statusCode === 429) {
      const err = new Error('Rate limited. Please wait before sending more queries.') as any;
      err.isRateLimit = true;
      return err;
    }
    if (statusCode === 400 && isRejectedModelOrMode(lowered)) {
      const err = new Error('The selected model or mode was rejected by Perplexity. Try another model or switch back to the normal variant.') as any;
      err.isAccessDenied = true;
      return err;
    }
    if (statusCode === 403) {
      const snippet = body.substring(0, 300).replace(/\n/g, ' ').trim();
      const err = new Error(`Access denied (403: ${snippet || 'no details'}).`) as any;
      err.isAccessDenied = true;
      return err;
    }
    return new Error(`Perplexity returned error ${statusCode}: ${body.substring(0, 300)}`);
  }

  private _buildCookie(): string {
    if (this.fullCookies) {
      return this.fullCookies;
    }
    return `__Secure-next-auth.session-token=${this.sessionToken}; next-auth.csrf-token=${this.csrfToken}`;
  }

  private _uuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const random = Math.random() * 16 | 0;
      const value = char === 'x' ? random : (random & 0x3 | 0x8);
      return value.toString(16);
    });
  }
}

function extractTextFromPayload(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      for (const step of parsed) {
        if (step?.step_type === 'FINAL' && step?.content?.answer) {
          try {
            const answer = JSON.parse(step.content.answer);
            return answer?.answer || '';
          } catch {
            return step.content.answer;
          }
        }
      }
    }
  } catch {
    return rawText;
  }

  return rawText;
}

function collectCitations(data: any): string[] {
  if (Array.isArray(data?.web_results)) {
    return data.web_results.map((result: any) => result?.url).filter(Boolean);
  }
  if (Array.isArray(data?.citations)) {
    return data.citations.map((citation: any) => typeof citation === 'string' ? citation : citation?.url).filter(Boolean);
  }
  return [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function isAuthenticationFailure(loweredBody: string): boolean {
  return [
    'session expired',
    'unauthorized',
    'not authenticated',
    'authentication',
    'csrf',
    'login',
    'sign in',
    'forbidden: csrf',
  ].some((needle) => loweredBody.includes(needle));
}

function isCloudflareBlock(loweredBody: string): boolean {
  return [
    'cloudflare',
    'cf-browser-verification',
    'challenge-platform',
    'just a moment',
    'ray id',
  ].some((needle) => loweredBody.includes(needle));
}

function isRejectedModelOrMode(loweredBody: string): boolean {
  return [
    'model_preference',
    'search_mode',
    'invalid model',
    'unsupported model',
    'unsupported mode',
    'not available for this account',
    'access denied',
  ].some((needle) => loweredBody.includes(needle));
}
