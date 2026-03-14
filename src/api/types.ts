/**
 * Shared PerplexiCode type definitions.
 */

export type AccountStatus = 'active' | 'rate_limited' | 'expired' | 'error' | 'disabled';
export type AccountPlan = 'free' | 'pro' | 'max' | 'enterprise' | 'unknown';
export type RotationStrategy = 'round-robin' | 'least-used' | 'failover-only';
export type QuerySource = 'web' | 'scholar' | 'social';
export type PerplexitySearchMode =
  | 'search'
  | 'research'
  | 'agentic_research'
  | 'studio'
  | 'study'
  | 'document_review'
  | 'browser_agent'
  | 'asi';
export type PerplexityRequestMode = 'CONCISE' | 'COPILOT' | 'ASI';
export type QuotaBucket =
  | 'free_queries'
  | 'pro_search'
  | 'research'
  | 'agentic_research'
  | 'labs'
  | 'computer'
  | 'study'
  | 'document_review';
export type QuotaKind = 'exact' | 'approximate' | 'unlimited' | 'unknown' | 'none';

export interface QuotaSnapshotItem {
  available: boolean;
  kind: QuotaKind;
  remaining?: number;
  label?: string;
  rawKind?: string;
}

export interface AccountQuotaSnapshot {
  fetchedAt?: string;
  freeQueries?: QuotaSnapshotItem;
  modes?: Record<string, QuotaSnapshotItem>;
  sources?: Record<string, QuotaSnapshotItem>;
}

export interface AccountCapabilities {
  fetchedAt?: string;
  plan: AccountPlan;
  displayName?: string;
  email?: string;
  subscriptionTier?: string;
  paymentTier?: string;
  subscriptionStatus?: string;
  subscriptionSource?: string;
  canUseComputer?: boolean;
  canUseLabs?: boolean;
  canUseResearch?: boolean;
  canUseAgenticResearch?: boolean;
  availableModelIds?: string[];
  blockedModelIds?: string[];
  modelsConfig?: PerplexityModelsConfigSnapshot;
}

export interface AccountSession {
  id: string;
  alias: string;
  sessionToken: string;
  csrfToken: string;
  fullCookies?: string;
  status: AccountStatus;
  addedAt: string;
  lastUsedAt?: string;
  queriestoday: number;
  queriesTotalLifetime: number;
  cooldownUntil?: string;
  errorCount: number;
  color?: string;
  capabilities?: AccountCapabilities;
  quotas?: AccountQuotaSnapshot;
}

// Serializable version for storage. Secret values live in SecretStorage.
export interface AccountMeta {
  id: string;
  alias: string;
  status: AccountStatus;
  addedAt: string;
  lastUsedAt?: string;
  queriestoday: number;
  queriesTotalLifetime: number;
  cooldownUntil?: string;
  errorCount: number;
  color?: string;
  capabilities?: AccountCapabilities;
  quotas?: AccountQuotaSnapshot;
}

export interface AccountSelectionRequirements {
  modelId: string;
  featureMode: PerplexitySearchMode;
  quotaBucket: QuotaBucket;
  requiredPlan: AccountPlan;
}

export interface WebQueryRequest {
  query: string;
  model: string;
  sources?: QuerySource[];
  language?: string;
}

export interface WebQueryResponse {
  text: string;
  citations?: string[];
}

export interface StreamResponseMeta {
  requestedModel: string;
  resolvedModel: string;
  displayModel: string;
  searchMode: PerplexitySearchMode;
  mode: PerplexityRequestMode;
}

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onCitations?: (citations: string[]) => void;
  onMeta?: (meta: Partial<StreamResponseMeta>) => void;
  onDone: (fullContent: string, meta: StreamResponseMeta) => void;
  onError: (error: Error) => void;
}

export interface QueryRequestOptions {
  sources?: QuerySource[];
  language?: string;
  searchMode?: PerplexitySearchMode;
  requestMode?: PerplexityRequestMode;
}

export interface PerplexityModelConfigEntry {
  label: string;
  description?: string | null;
  subheading?: string | null;
  has_new_tag?: boolean;
  subscription_tier?: string | null;
  non_reasoning_model?: string | null;
  reasoning_model?: string | null;
  text_only_model?: boolean;
}

export interface PerplexityModelDefinition {
  label: string;
  description?: string | null;
  mode: PerplexitySearchMode;
  provider?: string | null;
}

export interface PerplexityModelsConfigSnapshot {
  fetchedAt?: string;
  config_schema?: string;
  models: Record<string, PerplexityModelDefinition>;
  config: PerplexityModelConfigEntry[];
  default_models?: Partial<Record<PerplexitySearchMode, string>>;
  agentic_research_compare_models?: string[];
}
