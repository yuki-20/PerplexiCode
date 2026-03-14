import {
  AccountPlan,
  PerplexityModelsConfigSnapshot,
  PerplexityRequestMode,
  PerplexitySearchMode,
  QuotaBucket,
} from './types';

export interface ModelInfo {
  id: string;
  label: string;
  category: string;
  description: string;
  searchMode: PerplexitySearchMode;
  requestMode: PerplexityRequestMode;
  quotaBucket: QuotaBucket;
  requiredPlan: AccountPlan;
  supportsThinking: boolean;
  thinkingModelId?: string;
  selectable?: boolean;
  provider?: string | null;
  sortOrder?: number;
  surfaced?: boolean;
  isNew?: boolean;
}

interface ModelTemplate extends ModelInfo {
  aliases: string[];
  thinkingAliases?: string[];
  fallbackVisible?: boolean;
}

const MODEL_TEMPLATES: ModelTemplate[] = [
  {
    id: 'turbo',
    label: 'Best',
    category: 'Search Models',
    description: 'Selects your best available model automatically.',
    searchMode: 'search',
    requestMode: 'CONCISE',
    quotaBucket: 'free_queries',
    requiredPlan: 'free',
    supportsThinking: false,
    aliases: ['default', 'best', 'baseline', 'turbo'],
  },
  {
    id: 'experimental',
    label: 'Sonar',
    category: 'Search Models',
    description: 'Perplexity Sonar for fast web search and summarization.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: false,
    aliases: ['experimental', 'sonar'],
  },
  {
    id: 'gpt54',
    label: 'GPT-5.4',
    category: 'Search Models',
    description: 'OpenAI GPT-5.4 with an optional thinking variant.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: true,
    thinkingModelId: 'gpt54_thinking',
    aliases: ['gpt5', 'gpt52', 'gpt54', 'gpt-5', 'gpt-5.2', 'gpt-5.4'],
    thinkingAliases: [
      'gpt52_thinking',
      'gpt54_thinking',
      'gpt52thinking',
      'gpt54thinking',
      'gpt-5.2-thinking',
      'gpt-5.4-thinking',
    ],
  },
  {
    id: 'gemini31pro_high',
    label: 'Gemini 3.1 Pro',
    category: 'Search Models',
    description: 'Gemini 3.1 Pro with reasoning always enabled.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: false,
    aliases: ['gemini31prohigh', 'gemini31pro', 'gemini-3.1-pro', 'gemini 3.1 pro'],
  },
  {
    id: 'claude46sonnet',
    label: 'Claude Sonnet 4.6',
    category: 'Search Models',
    description: 'Claude Sonnet 4.6 with an optional thinking variant for technical work.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: true,
    thinkingModelId: 'claude46sonnetthinking',
    aliases: ['claude46sonnet', 'claude4.6sonnet', 'claudesonnet46', 'claude-4.6-sonnet', 'claude sonnet 4.6'],
    thinkingAliases: [
      'claude46sonnetthinking',
      'claude46sonnet_thinking',
      'claudesonnet46thinking',
      'claude-4.6-sonnet-thinking',
      'claude sonnet 4.6 thinking',
    ],
  },
  {
    id: 'nemotron_3_super',
    label: 'Nemotron 3 Super',
    category: 'Search Models',
    description: 'NVIDIA Nemotron 3 Super for advanced coding and analysis.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: false,
    aliases: ['nemotron_3_super', 'nemotron3super', 'nemotron-3-super', 'nemotron 3 super'],
    fallbackVisible: false,
  },
  {
    id: 'kimi_k2_5_thinking',
    label: 'Kimi K2.5 Thinking',
    category: 'Search Models',
    description: 'Kimi K2.5 with reasoning always enabled.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'pro',
    supportsThinking: false,
    aliases: [
      'kimi_k2_5_thinking',
      'kimi-k2.5-thinking',
      'kimi k2.5 thinking',
      'kimik25thinking',
      'k2.5thinking',
    ],
    fallbackVisible: false,
  },
  {
    id: 'claude46opus',
    label: 'Claude Opus 4.6',
    category: 'Max Models',
    description: 'Anthropic Claude Opus. Max or Enterprise only.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'max',
    supportsThinking: true,
    thinkingModelId: 'claude46opusthinking',
    aliases: ['claude46opus', 'claudeopus46', 'claude-opus-4.6', 'claude 4.6 opus'],
    thinkingAliases: [
      'claude46opusthinking',
      'claude46opus_thinking',
      'claudeopus46thinking',
      'claude-4.6-opus-thinking',
      'claude opus 4.6 thinking',
    ],
  },
  {
    id: 'grok_4',
    label: 'Grok 4',
    category: 'Max Models',
    description: 'Grok with advanced search and reasoning for Max-tier accounts.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'max',
    supportsThinking: false,
    aliases: ['grok4', 'grok41', 'grok-4', 'grok-4.1', 'grok 4', 'grok 4.1'],
    fallbackVisible: false,
  },
  {
    id: 'o3_pro',
    label: 'o3-Pro',
    category: 'Max Models',
    description: 'OpenAI o3-Pro for complex analytical tasks on Max-tier accounts.',
    searchMode: 'search',
    requestMode: 'COPILOT',
    quotaBucket: 'pro_search',
    requiredPlan: 'max',
    supportsThinking: false,
    aliases: ['o3', 'o3pro', 'o3-pro', 'o3 pro'],
    fallbackVisible: false,
  },
];

let runtimeCatalog = new Map<string, ModelInfo>();

export function setRuntimeModelCatalog(models: ModelInfo[]): void {
  runtimeCatalog = new Map(models.map((model) => [model.id, { ...model }]));
}

export function getFallbackModelCatalog(): ModelInfo[] {
  return MODEL_TEMPLATES
    .filter((template) => template.fallbackVisible !== false)
    .map(stripTemplateMetadata);
}

export function buildModelsFromAvailableIds(
  availableModelIds: string[],
  accountPlan: AccountPlan = 'unknown'
): ModelInfo[] {
  const rawIds = uniqueStrings(availableModelIds);
  if (rawIds.length === 0) {
    return getFallbackModelCatalog();
  }

  const models = new Map<string, ModelInfo>();

  for (const rawId of rawIds) {
    const match = matchTemplate(rawId);
    if (!match) {
      continue;
    }

    if (match.kind === 'thinking') {
      const baseAvailable = rawIds.some((candidate) => {
        const candidateMatch = matchTemplate(candidate);
        return candidateMatch?.kind === 'base' && candidateMatch.template.id === match.template.id;
      });

      if (baseAvailable) {
        continue;
      }

      const explicitThinkingVariant = toThinkingVariant(match.template, rawId);
      models.set(explicitThinkingVariant.id, explicitThinkingVariant);
      continue;
    }

    const modelId = isRequestId(rawId) ? rawId.trim() : match.template.id;
    const thinkingModelId = match.template.supportsThinking
      ? resolveThinkingModelId(match.template, modelId, rawIds)
      : undefined;

    models.set(modelId, {
      ...stripTemplateMetadata(match.template),
      id: modelId,
      supportsThinking: Boolean(thinkingModelId),
      thinkingModelId,
      requiredPlan: inferRequiredPlan(match.template, accountPlan),
    });
  }

  if (models.size === 0) {
    return getFallbackModelCatalog();
  }

  return [...models.values()].sort(compareModels);
}

export function buildModelsFromConfig(
  modelsConfig: PerplexityModelsConfigSnapshot,
  accountPlan: AccountPlan = 'unknown'
): ModelInfo[] {
  const modelDefinitions = modelsConfig.models || {};
  const models = new Map<string, ModelInfo>();
  const representedIds = new Set<string>();
  const familyPlanHints = new Map<string, AccountPlan>();
  let order = 0;

  const bestModel = buildBestModelFromConfig(modelDefinitions, modelsConfig.default_models?.search);
  if (bestModel) {
    models.set(bestModel.id, {
      ...bestModel,
      sortOrder: order++,
    });
    for (const aliasId of ['turbo', 'pplx_pro', 'pplx_pro_upgraded']) {
      if (modelDefinitions[aliasId]?.mode === 'search') {
        representedIds.add(aliasId);
      }
    }
    familyPlanHints.set(toFamilyKey(bestModel.label), bestModel.requiredPlan);
  }

  for (const entry of modelsConfig.config || []) {
    const nonReasoningId = normalizeConfigModelId(entry.non_reasoning_model);
    const reasoningId = normalizeConfigModelId(entry.reasoning_model);
    const primaryId = nonReasoningId || reasoningId;
    if (!primaryId) {
      continue;
    }

    const primaryDefinition = modelDefinitions[primaryId];
    const reasoningDefinition = reasoningId ? modelDefinitions[reasoningId] : undefined;
    const mode = primaryDefinition?.mode || reasoningDefinition?.mode;
    if (mode !== 'search') {
      continue;
    }

    const label = firstNonEmptyString(entry.label, primaryDefinition?.label, reasoningDefinition?.label, primaryId);
    const description = firstNonEmptyString(
      entry.description,
      primaryDefinition?.description,
      reasoningDefinition?.description,
      `${label} on Perplexity.`
    );
    const requiredPlan = normalizeRequiredPlan(entry.subscription_tier, accountPlan);
    const familyKey = toFamilyKey(label);
    familyPlanHints.set(familyKey, requiredPlan);

    if (nonReasoningId) {
      models.set(nonReasoningId, {
        id: nonReasoningId,
        label,
        category: 'Featured Search Models',
        description,
        searchMode: 'search',
        requestMode: 'COPILOT',
        quotaBucket: nonReasoningId === 'turbo' ? 'free_queries' : 'pro_search',
        requiredPlan,
        supportsThinking: Boolean(reasoningId),
        thinkingModelId: reasoningId || undefined,
        provider: primaryDefinition?.provider || reasoningDefinition?.provider || null,
        sortOrder: order++,
        surfaced: true,
        isNew: entry.has_new_tag === true,
      });
      representedIds.add(nonReasoningId);
      if (reasoningId) {
        representedIds.add(reasoningId);
      }
      continue;
    }

    if (!reasoningId) {
      continue;
    }

    models.set(reasoningId, {
      id: reasoningId,
      label,
      category: 'Featured Search Models',
      description,
      searchMode: 'search',
      requestMode: 'COPILOT',
      quotaBucket: 'pro_search',
      requiredPlan,
      supportsThinking: false,
      provider: reasoningDefinition?.provider || primaryDefinition?.provider || null,
      sortOrder: order++,
      surfaced: true,
      isNew: entry.has_new_tag === true,
    });
    representedIds.add(reasoningId);
  }

  const additionalDefinitions = Object.entries(modelDefinitions)
    .filter(([modelId, definition]) => definition.mode === 'search' && !representedIds.has(modelId))
    .filter(([modelId]) => !looksLikeInternalModel(modelId))
    .sort((left, right) => left[1].label.localeCompare(right[1].label));

  for (const [modelId, definition] of additionalDefinitions) {
    const label = firstNonEmptyString(definition.label, modelId);
    models.set(modelId, {
      id: modelId,
      label,
      category: getAdditionalCategory(definition.provider),
      description: firstNonEmptyString(
        definition.description,
        `${label} is available in Perplexity's authenticated model config.`
      ),
      searchMode: 'search',
      requestMode: 'COPILOT',
      quotaBucket: modelId === 'turbo' ? 'free_queries' : 'pro_search',
      requiredPlan: inferAdditionalModelPlan(label, familyPlanHints, accountPlan),
      supportsThinking: false,
      provider: definition.provider || null,
      sortOrder: 1_000 + order++,
      surfaced: false,
      isNew: false,
    });
  }

  if (models.size === 0) {
    return getFallbackModelCatalog();
  }

  return [...models.values()].sort(compareModels);
}

export function getModelCatalog(): ModelInfo[] {
  const merged = new Map<string, ModelInfo>();
  for (const model of getFallbackModelCatalog()) {
    merged.set(model.id, model);
  }
  for (const model of runtimeCatalog.values()) {
    merged.set(model.id, model);
  }
  return [...merged.values()];
}

export function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return modelId;
  }

  const exact = getMergedCatalog().find((model) => model.id === trimmed || model.thinkingModelId === trimmed);
  if (exact) {
    return trimmed;
  }

  const templateMatch = matchTemplate(trimmed);
  if (!templateMatch) {
    return trimmed;
  }

  if (templateMatch.kind === 'thinking') {
    return templateMatch.template.thinkingModelId || trimmed;
  }

  return templateMatch.template.id;
}

export function getModelById(modelId: string): ModelInfo | undefined {
  const baseModelId = getBaseModelId(modelId);
  return getMergedCatalog().find((model) => model.id === baseModelId);
}

export function modelSupportsThinking(modelId: string): boolean {
  return Boolean(getModelById(getBaseModelId(modelId))?.supportsThinking);
}

export function getBaseModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return modelId;
  }

  const exact = getMergedCatalog().find((model) => model.id === trimmed);
  if (exact) {
    return exact.id;
  }

  const runtimeVariant = getMergedCatalog().find((model) => model.thinkingModelId === trimmed);
  if (runtimeVariant) {
    return runtimeVariant.id;
  }

  const templateMatch = matchTemplate(trimmed);
  if (templateMatch?.kind === 'thinking') {
    return templateMatch.template.id;
  }

  const normalized = normalizeModelId(trimmed);
  const normalizedVariant = getMergedCatalog().find((model) => model.thinkingModelId === normalized);
  return normalizedVariant?.id || normalized;
}

export function isThinkingModelId(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return false;
  }

  const exact = getMergedCatalog().find((model) => model.id === trimmed);
  if (exact) {
    return false;
  }

  const runtimeVariant = getMergedCatalog().find((model) => model.thinkingModelId === trimmed);
  if (runtimeVariant) {
    return true;
  }

  return matchTemplate(trimmed)?.kind === 'thinking';
}

export function getResolvedModelId(modelId: string, thinkingEnabled: boolean): string {
  const model = getModelById(getBaseModelId(modelId));
  if (!model) {
    return normalizeModelId(modelId);
  }

  if (thinkingEnabled && model.thinkingModelId) {
    return model.thinkingModelId;
  }

  return model.id;
}

export function getModelLabel(modelId: string, thinkingEnabled = false): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return modelId;
  }

  const exact = getMergedCatalog().find((model) => model.id === trimmed);
  if (exact) {
    return exact.label;
  }

  const runtimeVariant = getMergedCatalog().find((model) => model.thinkingModelId === trimmed);
  if (runtimeVariant) {
    return `${runtimeVariant.label} Thinking`;
  }

  const templateMatch = matchTemplate(trimmed);
  if (templateMatch?.kind === 'thinking') {
    return `${templateMatch.template.label} Thinking`;
  }

  const normalized = normalizeModelId(trimmed);
  const model = getMergedCatalog().find((entry) => entry.id === normalized);
  if (!model) {
    return trimmed;
  }

  const isThinkingVariant = thinkingEnabled && model.supportsThinking;
  return isThinkingVariant ? `${model.label} Thinking` : model.label;
}

export function getDefaultSourcesForModel(_modelId: string): ('web' | 'scholar' | 'social')[] {
  return ['web'];
}

export function getCategoryOrder(category: string): number {
  const order = [
    'Featured Search Models',
    'Perplexity',
    'OpenAI',
    'Anthropic',
    'Google',
    'Moonshot AI',
    'xAI',
    'NVIDIA',
    'Additional Search Models',
    'Search Models',
    'Max Models',
  ];
  const index = order.indexOf(category);
  return index === -1 ? order.length : index;
}

export function compareModels(left: ModelInfo, right: ModelInfo): number {
  const sortOrder = compareOptionalNumber(left.sortOrder, right.sortOrder);
  if (sortOrder !== 0) {
    return sortOrder;
  }

  const categoryOrder = getCategoryOrder(left.category) - getCategoryOrder(right.category);
  if (categoryOrder !== 0) {
    return categoryOrder;
  }

  const templateOrder = getTemplateSortRank(left) - getTemplateSortRank(right);
  if (templateOrder !== 0) {
    return templateOrder;
  }

  return left.label.localeCompare(right.label);
}

function stripTemplateMetadata(template: ModelTemplate): ModelInfo {
  const { aliases: _aliases, thinkingAliases: _thinkingAliases, fallbackVisible: _fallbackVisible, ...model } = template;
  return { ...model };
}

function getMergedCatalog(): ModelInfo[] {
  const merged = new Map<string, ModelInfo>();
  for (const template of MODEL_TEMPLATES) {
    merged.set(template.id, stripTemplateMetadata(template));
  }
  for (const model of runtimeCatalog.values()) {
    merged.set(model.id, model);
  }
  return [...merged.values()];
}

function getTemplateSortRank(model: Pick<ModelInfo, 'id'>): number {
  const match = matchTemplate(model.id);
  if (!match) {
    return MODEL_TEMPLATES.length;
  }

  const index = MODEL_TEMPLATES.findIndex((template) => template.id === match.template.id);
  return index === -1 ? MODEL_TEMPLATES.length : index;
}

function matchTemplate(modelId: string): { template: ModelTemplate; kind: 'base' | 'thinking' } | undefined {
  const token = normalizeLookupToken(modelId);
  if (!token) {
    return undefined;
  }

  const baseMatch = MODEL_TEMPLATES.find((template) =>
    [template.id, ...template.aliases].some((candidate) => normalizeLookupToken(candidate) === token)
  );
  if (baseMatch) {
    return { template: baseMatch, kind: 'base' };
  }

  const thinkingMatch = MODEL_TEMPLATES.find((template) =>
    (template.thinkingAliases || []).some((candidate) => normalizeLookupToken(candidate) === token)
    || normalizeLookupToken(template.thinkingModelId || '') === token
  );

  return thinkingMatch ? { template: thinkingMatch, kind: 'thinking' } : undefined;
}

function resolveThinkingModelId(template: ModelTemplate, baseId: string, availableIds: string[]): string | undefined {
  if (!template.supportsThinking) {
    return undefined;
  }

  const exact = availableIds.find((candidate) => {
    const token = normalizeLookupToken(candidate);
    return normalizeLookupToken(template.thinkingModelId || '') === token
      || (template.thinkingAliases || []).some((alias) => normalizeLookupToken(alias) === token);
  });
  if (exact && isRequestId(exact)) {
    return exact.trim();
  }

  if (isRequestId(baseId)) {
    return baseId.endsWith('_thinking') ? baseId : `${baseId}_thinking`;
  }

  return template.thinkingModelId;
}

function toThinkingVariant(template: ModelTemplate, rawId: string): ModelInfo {
  const modelId = isRequestId(rawId)
    ? rawId.trim()
    : (template.thinkingModelId || `${template.id}_thinking`);

  return {
    ...stripTemplateMetadata(template),
    id: modelId,
    label: `${template.label} Thinking`,
    description: `${template.label} thinking variant for deeper technical analysis.`,
    supportsThinking: false,
    thinkingModelId: undefined,
  };
}

function inferRequiredPlan(template: ModelTemplate, accountPlan: AccountPlan): AccountPlan {
  if (template.requiredPlan === 'max' || template.requiredPlan === 'enterprise') {
    return template.requiredPlan;
  }

  if (accountPlan === 'max' || accountPlan === 'enterprise') {
    return template.requiredPlan;
  }

  return template.requiredPlan;
}

function uniqueStrings(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    unique.set(trimmed.toLowerCase(), trimmed);
  }
  return [...unique.values()];
}

function isRequestId(value: string): boolean {
  return /^[a-z0-9_.-]+$/i.test(value.trim());
}

function normalizeLookupToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  if (typeof left === 'number') {
    return -1;
  }
  if (typeof right === 'number') {
    return 1;
  }
  return 0;
}

function normalizeConfigModelId(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstNonEmptyString(...values: Array<string | null | undefined>): string {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() || '';
}

function normalizeRequiredPlan(value: string | null | undefined, accountPlan: AccountPlan): AccountPlan {
  const normalized = (value || '').trim().toLowerCase();
  switch (normalized) {
    case 'free':
    case 'pro':
    case 'max':
    case 'enterprise':
      return normalized;
    default:
      return accountPlan === 'free' ? 'pro' : 'pro';
  }
}

function toFamilyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+(thinking|low thinking)$/i, '')
    .replace(/\s+\d+(\.\d+)?$/i, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function inferAdditionalModelPlan(
  label: string,
  familyPlanHints: Map<string, AccountPlan>,
  _accountPlan: AccountPlan
): AccountPlan {
  const familyHint = familyPlanHints.get(toFamilyKey(label));
  if (familyHint) {
    return familyHint;
  }

  return /\bopus\b/i.test(label) ? 'max' : 'pro';
}

function getAdditionalCategory(provider: string | null | undefined): string {
  switch ((provider || '').trim().toUpperCase()) {
    case 'PERPLEXITY':
    case 'SONAR':
      return 'Perplexity';
    case 'OPENAI':
      return 'OpenAI';
    case 'ANTHROPIC':
      return 'Anthropic';
    case 'GOOGLE':
      return 'Google';
    case 'MOONSHOT_AI':
      return 'Moonshot AI';
    case 'XAI':
      return 'xAI';
    case 'NVIDIA':
      return 'NVIDIA';
    default:
      return 'Additional Search Models';
  }
}

function looksLikeInternalModel(modelId: string): boolean {
  const lowered = modelId.toLowerCase();
  return lowered.includes('internal_testing');
}

function buildBestModelFromConfig(
  modelDefinitions: Record<string, { label: string; description?: string | null; mode: PerplexitySearchMode; provider?: string | null }>,
  defaultSearchModelId: string | undefined
): ModelInfo | undefined {
  const preferredIds = [
    normalizeConfigModelId(defaultSearchModelId),
    'turbo',
    'pplx_pro',
    'pplx_pro_upgraded',
  ].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);

  const definitionId = preferredIds.find((candidate) => modelDefinitions[candidate]?.mode === 'search');
  if (!definitionId) {
    return undefined;
  }

  const definition = modelDefinitions[definitionId];
  return {
    id: modelDefinitions.turbo?.mode === 'search' ? 'turbo' : definitionId,
    label: 'Best',
    category: 'Featured Search Models',
    description: firstNonEmptyString(
      definition.description,
      'Automatically selects the best Perplexity model for the query.'
    ),
    searchMode: 'search',
    requestMode: 'CONCISE',
    quotaBucket: 'free_queries',
    requiredPlan: 'free',
    supportsThinking: false,
    provider: definition.provider || 'PERPLEXITY',
    surfaced: true,
    isNew: false,
  };
}
