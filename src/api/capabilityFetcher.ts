import * as https from 'https';
import { ModelsConfigFetcher } from './modelsConfigFetcher';
import {
  AccountCapabilities,
  AccountPlan,
  AccountQuotaSnapshot,
  AccountSelectionRequirements,
  AccountSession,
  QuotaBucket,
  QuotaKind,
  QuotaSnapshotItem,
} from './types';

const PERPLEXITY_HOST = 'www.perplexity.ai';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export class CapabilityFetcher {
  private readonly cacheTtlMs: number;
  private readonly modelsConfigFetcher: ModelsConfigFetcher;

  constructor(cacheTtlMs: number = 60_000) {
    this.cacheTtlMs = cacheTtlMs;
    this.modelsConfigFetcher = new ModelsConfigFetcher();
  }

  async refreshAccounts(accounts: AccountSession[], force = false): Promise<void> {
    await Promise.all(accounts.map(async (account) => {
      if (account.status === 'disabled' || account.status === 'expired') {
        return;
      }
      try {
        await this.refreshAccount(account, force);
      } catch {
        // Keep the last known snapshot.
      }
    }));
  }

  async refreshAccount(account: AccountSession, force = false): Promise<void> {
    if (!force && this._isFresh(account)) {
      return;
    }

    const [session, visitorInformation, rateLimitAll, freeQueries, asiAccessDecision, modelsConfig] = await Promise.all([
      this._fetchJson(account, '/api/auth/session').catch(() => null),
      this._fetchJson(account, '/rest/visitor/information').catch(() => null),
      this._fetchJson(account, '/rest/rate-limit/all').catch(() => null),
      this._fetchJson(account, '/rest/rate-limit/free-queries').catch(() => null),
      this._fetchJson(account, '/rest/billing/asi-access-decision').catch(() => null),
      this.modelsConfigFetcher.fetch(account).catch(() => undefined),
    ]);

    const quotas = buildQuotaSnapshot(rateLimitAll, freeQueries, asiAccessDecision, account.quotas);
    const capabilities = buildCapabilities(
      session,
      visitorInformation,
      rateLimitAll,
      asiAccessDecision,
      modelsConfig,
      account.capabilities,
      force
    );

    capabilities.canUseLabs = quotas.modes?.labs?.available ?? capabilities.canUseLabs;
    capabilities.canUseResearch = quotas.modes?.research?.available ?? capabilities.canUseResearch;
    capabilities.canUseAgenticResearch = quotas.modes?.agentic_research?.available ?? capabilities.canUseAgenticResearch;
    capabilities.canUseComputer = quotas.modes?.computer?.available ?? capabilities.canUseComputer;

    account.capabilities = capabilities;
    account.quotas = quotas;
  }

  /**
   * Lightweight quota-only refresh that only hits rate-limit endpoints.
   * Much faster than refreshAccount — no session/visitor/models config fetch.
   * Always fetches fresh data (ignores cache).
   */
  async refreshQuotas(accounts: AccountSession[]): Promise<void> {
    await Promise.all(accounts.map(async (account) => {
      if (account.status === 'disabled' || account.status === 'expired') {
        return;
      }
      try {
        await this.refreshAccountQuotas(account);
        // Reset error/rate_limited accounts back to active after a successful quota fetch
        if (account.status === 'error' || account.status === 'rate_limited') {
          account.status = 'active';
          account.errorCount = 0;
          account.cooldownUntil = undefined;
        }
      } catch {
        // Keep last known snapshot
      }
    }));
  }

  async refreshAccountQuotas(account: AccountSession): Promise<void> {
    const [rateLimitAll, freeQueries] = await Promise.all([
      this._fetchJson(account, '/rest/rate-limit/all').catch(() => null),
      this._fetchJson(account, '/rest/rate-limit/free-queries').catch(() => null),
    ]);

    const quotas = buildQuotaSnapshot(rateLimitAll, freeQueries, null, account.quotas);
    account.quotas = quotas;

    // Clear stale blocked model IDs — they were a temporary optimization, not permanent bans
    if (account.capabilities) {
      account.capabilities.blockedModelIds = undefined;
      account.capabilities.canUseLabs = quotas.modes?.labs?.available ?? account.capabilities.canUseLabs;
      account.capabilities.canUseResearch = quotas.modes?.research?.available ?? account.capabilities.canUseResearch;
      account.capabilities.canUseAgenticResearch = quotas.modes?.agentic_research?.available ?? account.capabilities.canUseAgenticResearch;
    }
  }

  noteUsage(account: AccountSession, bucket: QuotaBucket): void {
    const item = getQuotaItem(account, bucket);
    if (!item || item.kind !== 'exact' || typeof item.remaining !== 'number') {
      return;
    }

    item.remaining = Math.max(0, item.remaining - 1);
    item.available = item.remaining > 0;
  }

  noteQuotaFailure(account: AccountSession, bucket: QuotaBucket): void {
    const item = getQuotaItem(account, bucket);
    if (item) {
      item.available = false;
      if (item.kind === 'exact' && typeof item.remaining !== 'number') {
        item.remaining = 0;
      }
    }

    if (bucket === 'computer' && account.capabilities) {
      account.capabilities.canUseComputer = false;
    }
  }

  private _isFresh(account: AccountSession): boolean {
    const timestamps = [
      account.capabilities?.fetchedAt,
      account.quotas?.fetchedAt,
    ].filter(Boolean) as string[];

    if (timestamps.length === 0) {
      return false;
    }

    return timestamps.every((value) => (Date.now() - Date.parse(value)) < this.cacheTtlMs);
  }

  private _fetchJson(account: AccountSession, path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: 'GET',
          hostname: PERPLEXITY_HOST,
          path,
          headers: {
            'Accept': 'application/json',
            'Cookie': buildCookie(account),
            'Referer': 'https://www.perplexity.ai/',
            'Origin': 'https://www.perplexity.ai',
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
              reject(new Error(`Capability fetch failed for ${path} (${res.statusCode || 0})`));
              return;
            }

            try {
              resolve(body ? JSON.parse(body) : null);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy(new Error(`Capability fetch timed out for ${path}`));
      });
      req.end();
    });
  }
}

export function accountCanSatisfyRequirement(
  account: AccountSession,
  requirement?: AccountSelectionRequirements
): boolean {
  if (!requirement) {
    return true;
  }

  const capabilities = account.capabilities;
  if (capabilities?.blockedModelIds?.includes(requirement.modelId)) {
    return false;
  }
  if (capabilities && !planSatisfiesRequirement(capabilities.plan, requirement.requiredPlan)) {
    return false;
  }

  if (capabilities) {
    if (requirement.featureMode === 'studio' && capabilities.canUseLabs === false) {
      return false;
    }
    if (requirement.featureMode === 'asi' && capabilities.canUseComputer === false) {
      return false;
    }
    if (requirement.featureMode === 'research' && capabilities.canUseResearch === false) {
      return false;
    }
    if (requirement.featureMode === 'agentic_research' && capabilities.canUseAgenticResearch === false) {
      return false;
    }
  }

  const quota = getQuotaItem(account, requirement.quotaBucket);
  if (quota) {
    return quota.available;
  }

  if (requirement.quotaBucket === 'computer' && capabilities) {
    return capabilities.canUseComputer !== false;
  }

  return true;
}

export function markModelUnavailable(account: AccountSession, modelId: string): void {
  if (!account.capabilities) {
    account.capabilities = {
      plan: 'unknown',
      blockedModelIds: [modelId],
    };
    return;
  }

  const blocked = new Set(account.capabilities.blockedModelIds || []);
  blocked.add(modelId);
  account.capabilities.blockedModelIds = [...blocked];
}

export function planSatisfiesRequirement(plan: AccountPlan, requiredPlan: AccountPlan): boolean {
  return planRank(plan) >= planRank(requiredPlan);
}

export function getQuotaItem(account: AccountSession, bucket: QuotaBucket): QuotaSnapshotItem | undefined {
  if (bucket === 'free_queries') {
    return account.quotas?.freeQueries;
  }

  const modeQuota = account.quotas?.modes?.[bucket];
  if (modeQuota) {
    return modeQuota;
  }

  if (bucket === 'computer') {
    if (account.capabilities?.canUseComputer === false) {
      return { available: false, kind: 'none', remaining: 0 };
    }
    if (account.capabilities?.canUseComputer === true) {
      return { available: true, kind: 'unknown' };
    }
  }

  return undefined;
}

export function formatQuotaSummary(item?: QuotaSnapshotItem): string {
  if (!item) {
    return 'Unknown';
  }
  if (!item.available) {
    return 'Unavailable';
  }
  if (item.kind === 'unlimited') {
    return 'Unlimited';
  }
  if (item.kind === 'exact' && typeof item.remaining === 'number') {
    return `${item.remaining} left`;
  }
  if (item.kind === 'approximate' && typeof item.remaining === 'number') {
    return `~${item.remaining} left`;
  }
  return item.label || 'Available';
}

function buildCookie(account: AccountSession): string {
  if (account.fullCookies) {
    return account.fullCookies;
  }
  return `__Secure-next-auth.session-token=${account.sessionToken}; next-auth.csrf-token=${account.csrfToken}`;
}

function buildCapabilities(
  session: any,
  visitorInformation: any,
  rateLimitAll: any,
  asiAccessDecision: any,
  modelsConfig: AccountCapabilities['modelsConfig'],
  previous?: AccountCapabilities,
  force = false
): AccountCapabilities {
  const now = new Date().toISOString();
  const user = session?.user || {};
  const plan = resolvePlan(session, visitorInformation, rateLimitAll);
  const availableModelIds = collectAvailableModelIds(modelsConfig, session, visitorInformation, rateLimitAll);

  return {
    fetchedAt: now,
    plan,
    displayName: firstString(user?.name, visitorInformation?.name, previous?.displayName),
    email: firstString(user?.email, previous?.email),
    subscriptionTier: firstString(
      user?.subscription_tier,
      user?.subscriptionTier,
      visitorInformation?.subscriptionTier,
      previous?.subscriptionTier
    ),
    paymentTier: firstString(
      user?.payment_tier,
      user?.paymentTier,
      previous?.paymentTier
    ),
    subscriptionStatus: firstString(
      user?.subscription_status,
      user?.subscriptionStatus,
      visitorInformation?.stripeStatus,
      previous?.subscriptionStatus
    ),
    subscriptionSource: firstString(
      user?.subscription_source,
      user?.subscriptionSource,
      previous?.subscriptionSource
    ),
    canUseComputer: booleanOrFallback(
      asiAccessDecision?.can_use_computer,
      previous?.canUseComputer
    ),
    canUseLabs: booleanOrFallback(
      rateLimitAll?.modes?.labs?.available,
      previous?.canUseLabs
    ),
    canUseResearch: booleanOrFallback(
      rateLimitAll?.modes?.research?.available,
      previous?.canUseResearch
    ),
    canUseAgenticResearch: booleanOrFallback(
      rateLimitAll?.modes?.agentic_research?.available,
      previous?.canUseAgenticResearch
    ),
    modelsConfig: modelsConfig || (force ? undefined : previous?.modelsConfig),
    availableModelIds: availableModelIds.length > 0 ? availableModelIds : (force ? undefined : previous?.availableModelIds),
    blockedModelIds: undefined,
  };
}

function buildQuotaSnapshot(
  rateLimitAll: any,
  freeQueries: any,
  asiAccessDecision: any,
  previous?: AccountQuotaSnapshot
): AccountQuotaSnapshot {
  const snapshot: AccountQuotaSnapshot = {
    fetchedAt: new Date().toISOString(),
    freeQueries: normalizeQuotaEntry(
      freeQueries?.remaining_detail ? freeQueries : freeQueries?.free_queries,
      previous?.freeQueries
    ),
    modes: {},
    sources: {},
  };

  for (const [key, value] of Object.entries(rateLimitAll?.modes || {})) {
    snapshot.modes![key] = normalizeQuotaEntry(value);
  }

  for (const [key, value] of Object.entries(rateLimitAll?.sources || {})) {
    snapshot.sources![key] = normalizeQuotaEntry(value);
  }

  const computerQuota = extractComputerQuotaEntry(asiAccessDecision, previous?.modes?.computer);
  if (computerQuota) {
    snapshot.modes!.computer = computerQuota;
  }

  return snapshot;
}

function normalizeQuotaEntry(value: any, fallback?: QuotaSnapshotItem): QuotaSnapshotItem {
  if (!value) {
    return fallback || { available: true, kind: 'unknown' };
  }

  const available = value.available !== false;
  const detail = value.remaining_detail || value.remainingDetail || value;
  const remaining = firstNumber(
    detail?.remaining,
    detail?.count,
    detail?.value
  );
  const rawKind = firstString(detail?.kind, value?.kind);
  const kind = normalizeQuotaKind(rawKind, available, remaining);

  return {
    available: available && !(kind === 'exact' && remaining === 0),
    kind,
    remaining,
    label: firstString(value?.label, value?.display_text, detail?.label),
    rawKind,
  };
}

function extractComputerQuotaEntry(value: any, fallback?: QuotaSnapshotItem): QuotaSnapshotItem | undefined {
  const candidates = [
    value,
    value?.quota,
    value?.quota_snapshot,
    value?.quotaSnapshot,
    value?.credits,
    value?.credit_balance,
    value?.creditBalance,
    value?.remaining_detail,
    value?.remainingDetail,
    value?.data,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    if (
      'available' in candidate
      || 'remaining' in candidate
      || 'remaining_detail' in candidate
      || 'remainingDetail' in candidate
      || 'can_use_computer' in candidate
      || 'canUseComputer' in candidate
    ) {
      return normalizeQuotaEntry(candidate, fallback);
    }
  }

  if (typeof value?.can_use_computer === 'boolean' || typeof value?.canUseComputer === 'boolean') {
    return {
      available: Boolean(value?.can_use_computer ?? value?.canUseComputer),
      kind: 'unknown',
    };
  }

  return fallback;
}

function normalizeQuotaKind(
  rawKind: string | undefined,
  available: boolean,
  remaining: number | undefined
): QuotaKind {
  const normalized = (rawKind || '').toLowerCase();
  if (!available) {
    return 'none';
  }
  if (normalized === 'exact') {
    return 'exact';
  }
  if (normalized === 'approximate' || normalized === 'approx') {
    return 'approximate';
  }
  if (normalized === 'unlimited') {
    return 'unlimited';
  }
  if (typeof remaining === 'number') {
    return 'exact';
  }
  return 'unknown';
}

function resolvePlan(session: any, visitorInformation: any, rateLimitAll: any): AccountPlan {
  const user = session?.user || {};
  const strings = [
    user?.subscription_tier,
    user?.subscriptionTier,
    user?.payment_tier,
    user?.paymentTier,
    user?.subscription_status,
    user?.subscriptionStatus,
    user?.subscription_source,
    user?.subscriptionSource,
    visitorInformation?.subscriptionTier,
    visitorInformation?.stripeStatus,
  ].filter((value): value is string => typeof value === 'string');

  const lowered = strings.map((value) => value.toLowerCase());
  const hasValue = (needle: string) => lowered.some((value) => value.includes(needle));

  if (booleanIsTrue(user?.is_enterprise) || booleanIsTrue(user?.isEnterprise) || hasValue('enterprise')) {
    return 'enterprise';
  }
  if (booleanIsTrue(user?.is_max) || booleanIsTrue(user?.isMax) || hasValue('max')) {
    return 'max';
  }
  if (
    booleanIsTrue(user?.is_pro) ||
    booleanIsTrue(user?.isPro) ||
    hasValue('pro') ||
    user?.payment_tier === 'paid' ||
    user?.paymentTier === 'paid' ||
    visitorInformation?.stripeStatus === 'active' ||
    ['yearly', 'monthly'].includes((visitorInformation?.subscriptionTier || '').toLowerCase()) ||
    Boolean(rateLimitAll?.modes?.pro_search)
  ) {
    return 'pro';
  }
  return 'free';
}

function booleanOrFallback(value: unknown, fallback: boolean | undefined): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function booleanIsTrue(value: unknown): boolean {
  return value === true;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function collectAvailableModelIds(...sources: any[]): string[] {
  const found = new Set<string>();

  for (const source of sources) {
    if (!source || typeof source !== 'object') {
      continue;
    }

    if (source.models && typeof source.models === 'object' && !Array.isArray(source.models)) {
      for (const modelId of Object.keys(source.models)) {
        addPossibleModelId(modelId, found);
      }
    }

    for (const key of [
      'available_model_ids',
      'availableModelIds',
      'model_ids',
      'modelIds',
      'ai_model_ids',
      'aiModelIds',
      'search_model_ids',
      'searchModelIds',
      'models',
      'ai_models',
      'aiModels',
      'advanced_models',
      'advancedModels',
      'model_preferences',
      'modelPreferences',
    ]) {
      collectModelIdsFromValue((source as Record<string, unknown>)[key], found);
    }

    if (source.user && typeof source.user === 'object') {
      collectAvailableModelIds(source.user).forEach((modelId) => found.add(modelId));
    }

    if (source.capabilities && typeof source.capabilities === 'object') {
      collectAvailableModelIds(source.capabilities).forEach((modelId) => found.add(modelId));
    }
  }

  return [...found];
}

function collectModelIdsFromValue(value: unknown, found: Set<string>): void {
  if (!value) {
    return;
  }

  if (typeof value === 'string') {
    addPossibleModelId(value, found);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectModelIdsFromValue(entry, found);
    }
    return;
  }

  if (typeof value !== 'object') {
    return;
  }

  const record = value as Record<string, unknown>;

  for (const key of ['id', 'slug', 'model', 'model_id', 'modelId', 'preference']) {
    if (typeof record[key] === 'string') {
      addPossibleModelId(record[key] as string, found);
    }
  }

  for (const key of ['items', 'values', 'data']) {
    if (record[key]) {
      collectModelIdsFromValue(record[key], found);
    }
  }

  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'boolean' && entry && looksLikeModelId(key)) {
      found.add(key);
    }
  }
}

function addPossibleModelId(value: string, found: Set<string>): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  if (looksLikeModelId(trimmed)) {
    found.add(trimmed);
  }
}

function looksLikeModelId(value: string): boolean {
  const lowered = value.trim().toLowerCase();
  if (!lowered || lowered.startsWith('http')) {
    return false;
  }

  return [
    'gpt',
    'claude',
    'gemini',
    'sonar',
    'kimi',
    'grok',
    'o3',
    'turbo',
    'experimental',
    'opus',
    'sonnet',
    'thinking',
    'default',
  ].some((needle) => lowered.includes(needle));
}

function planRank(plan: AccountPlan): number {
  switch (plan) {
    case 'enterprise':
      return 4;
    case 'max':
      return 3;
    case 'pro':
      return 2;
    case 'free':
      return 1;
    default:
      return 0;
  }
}
