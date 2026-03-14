import { parseFileEdits } from '../src/agents/fileEditParser.ts';
import { accountCanSatisfyRequirement, CapabilityFetcher, getQuotaItem, markModelUnavailable, planSatisfiesRequirement } from '../src/api/capabilityFetcher.ts';
import { buildModelsFromConfig, getBaseModelId, getModelLabel, getResolvedModelId, isThinkingModelId, setRuntimeModelCatalog } from '../src/api/modelCatalog.ts';
import { ModelFetcher } from '../src/api/modelFetcher.ts';
import { normalizeModelsConfigPayload } from '../src/api/modelsConfigFetcher.ts';
import { PerplexityWebClient } from '../src/api/perplexityClient.ts';
import { TaskModeFetcher } from '../src/api/taskModeCatalog.ts';
import { AccountSession, AccountSelectionRequirements } from '../src/api/types.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function buildAccount(overrides: Partial<AccountSession> = {}): AccountSession {
  return {
    id: 'acct',
    alias: 'Test',
    sessionToken: 'session',
    csrfToken: 'csrf',
    status: 'active',
    addedAt: new Date().toISOString(),
    queriestoday: 0,
    queriesTotalLifetime: 0,
    errorCount: 0,
    ...overrides,
  };
}

async function run(): Promise<void> {
  console.log('Running source smoke tests...');

  assert(getResolvedModelId('gpt54', true) === 'gpt54_thinking', 'GPT-5.4 should resolve to the thinking variant');
  assert(getModelLabel('claude46sonnetthinking') === 'Claude Sonnet 4.6 Thinking', 'Thinking label should be human readable');
  assert(getBaseModelId('claude46sonnetthinking') === 'claude46sonnet', 'Thinking variants should map back to their base model');
  assert(isThinkingModelId('claude46sonnetthinking'), 'Thinking helper should detect reasoning variants');

  const modelFetcher = new ModelFetcher();
  const taskModeFetcher = new TaskModeFetcher();
  const dynamicModels = await modelFetcher.getModels(buildAccount({
    capabilities: {
      plan: 'pro',
      availableModelIds: ['gpt52', 'gpt52_thinking', 'claude46sonnetthinking', 'kimi-k2.5-thinking'],
    },
    quotas: { modes: { pro_search: { available: true, kind: 'exact', remaining: 5 } } },
  }));
  assert(
    dynamicModels.some((model) => model.id === 'gpt52' && model.supportsThinking && model.thinkingModelId === 'gpt52_thinking' && model.label === 'GPT-5.4'),
    'Model fetcher should preserve live GPT ids and wire the thinking variant'
  );
  assert(
    dynamicModels.some((model) => model.label === 'Claude Sonnet 4.6 Thinking'),
    'Thinking-only variants should be surfaced when the account exposes them'
  );
  assert(
    dynamicModels.some((model) => model.label === 'Kimi K2.5 Thinking'),
    'Latest Perplexity models like Kimi should be surfaced from available model ids'
  );
  assert(
    dynamicModels.some((model) => model.id === 'claude46opus' && model.selectable === false),
    'Visible Max-only models should remain listed but locked on lower plans'
  );
  const liveConfigPayload = normalizeModelsConfigPayload({
    config_schema: 'v1',
    models: {
      gpt54: { label: 'GPT-5.4', description: 'OpenAI latest', mode: 'search', provider: 'OPENAI' },
      gpt54_thinking: { label: 'GPT-5.4 Thinking', description: 'OpenAI latest with thinking', mode: 'search', provider: 'OPENAI' },
      gemini31pro_high: { label: 'Gemini 3.1 Pro Thinking', description: 'Google latest with thinking', mode: 'search', provider: 'GOOGLE' },
      claude46opus: { label: 'Claude Opus 4.6', description: 'Anthropic advanced', mode: 'search', provider: 'ANTHROPIC' },
      claude46opusthinking: { label: 'Claude Opus 4.6 Thinking', description: 'Anthropic advanced with thinking', mode: 'search', provider: 'ANTHROPIC' },
      nv_nemotron_3_super: { label: 'Nemotron 3 Super', description: 'NVIDIA latest', mode: 'search', provider: 'NVIDIA' },
      gpt51: { label: 'GPT-5.1', description: 'OpenAI latest', mode: 'search', provider: 'OPENAI' },
      gpt51_thinking: { label: 'GPT-5.1 Thinking', description: 'OpenAI latest with thinking', mode: 'search', provider: 'OPENAI' },
      pplx_beta: { label: 'Create files and apps', description: 'Labs', mode: 'studio', provider: 'PERPLEXITY' },
    },
    config: [
      {
        label: 'GPT-5.4',
        description: 'OpenAI latest',
        subscription_tier: 'pro',
        non_reasoning_model: 'gpt54',
        reasoning_model: 'gpt54_thinking',
      },
      {
        label: 'Gemini 3.1 Pro',
        description: 'Google latest',
        subscription_tier: 'pro',
        reasoning_model: 'gemini31pro_high',
      },
      {
        label: 'Claude Opus 4.6',
        description: 'Anthropic advanced',
        subscription_tier: 'max',
        non_reasoning_model: 'claude46opus',
        reasoning_model: 'claude46opusthinking',
      },
      {
        label: 'Nemotron 3 Super',
        description: 'NVIDIA latest',
        subscription_tier: 'pro',
        non_reasoning_model: null,
        reasoning_model: 'nv_nemotron_3_super',
        has_new_tag: true,
      },
    ],
  });
  assert(liveConfigPayload, 'Live models config payload should normalize');
  const liveConfigModels = buildModelsFromConfig(liveConfigPayload!, 'pro');
  assert(
    liveConfigModels.some((model) => model.id === 'gpt54' && model.supportsThinking && model.thinkingModelId === 'gpt54_thinking'),
    'Live config should build paired normal/thinking search models'
  );
  assert(
    liveConfigModels.some((model) => model.id === 'gemini31pro_high' && model.label === 'Gemini 3.1 Pro'),
    'Reasoning-only live config entries should remain selectable as standalone models'
  );
  assert(
    liveConfigModels.some((model) => model.id === 'nv_nemotron_3_super' && model.isNew === true),
    'Live config should preserve new-model badges'
  );
  assert(
    liveConfigModels.some((model) => model.id === 'gpt51') && liveConfigModels.some((model) => model.id === 'gpt51_thinking'),
    'Additional search models from the live config should still be listed'
  );
  const configBackedModels = await modelFetcher.getModels(buildAccount({
    capabilities: {
      plan: 'pro',
      modelsConfig: liveConfigPayload!,
      availableModelIds: ['gpt54', 'gpt54_thinking', 'gemini31pro_high', 'claude46opus', 'claude46opusthinking'],
    },
    quotas: { modes: { pro_search: { available: true, kind: 'exact', remaining: 5 } } },
  }));
  assert(
    configBackedModels.some((model) => model.id === 'claude46opus' && model.selectable === false),
    'Config-backed model lists should keep Max-only models locked on Pro accounts'
  );
  const proTaskModes = taskModeFetcher.getModes(buildAccount({
    capabilities: { plan: 'pro', canUseComputer: false },
    quotas: {
      modes: {
        labs: { available: true, kind: 'exact', remaining: 3 },
        computer: { available: false, kind: 'exact', remaining: 0 },
      },
    },
  }));
  assert(
    proTaskModes.some((mode) => mode.id === 'labs' && mode.selectable),
    'Create files and apps should be selectable when Labs quota is available'
  );
  assert(
    proTaskModes.some((mode) => mode.id === 'computer' && mode.selectable === false),
    'Computer should remain locked for non-Max accounts'
  );
  setRuntimeModelCatalog(dynamicModels);
  assert(getResolvedModelId('gpt52', true) === 'gpt52_thinking', 'Runtime catalog should resolve live thinking ids');

  const client = new PerplexityWebClient('session', 'csrf');
  const meta = (client as any)._buildInitialMeta('claude46opusthinking', {
    searchMode: 'search',
    requestMode: 'COPILOT',
  });
  assert(meta.resolvedModel === 'claude46opusthinking', 'Client should keep the resolved thinking slug');
  assert(meta.displayModel === 'Claude Opus 4.6 Thinking', 'Client should surface the thinking display label');
  assert(
    (client as any)._toRequestError(403, '{"message":"model not available for this account"}').message.includes('not available for the current account'),
    '403 model access failures should not be reported as expired sessions'
  );
  assert(
    (client as any)._toRequestError(401, '{"message":"unauthorized"}').message.includes('Session expired'),
    '401 responses should still surface session expiry'
  );

  assert(planSatisfiesRequirement('pro', 'free'), 'Pro should satisfy free plan requirements');
  assert(!planSatisfiesRequirement('pro', 'max'), 'Pro should not satisfy max plan requirements');

  const opusRequirement: AccountSelectionRequirements = {
    modelId: 'claude46opus',
    featureMode: 'search',
    quotaBucket: 'pro_search',
    requiredPlan: 'max',
  };
  const proAccount = buildAccount({
    capabilities: { plan: 'pro', canUseComputer: true },
    quotas: { modes: { pro_search: { available: true, kind: 'exact', remaining: 5 } } },
  });
  const maxAccount = buildAccount({
    id: 'max',
    capabilities: { plan: 'max', canUseComputer: true },
    quotas: {
      modes: {
        pro_search: { available: true, kind: 'exact', remaining: 5 },
        computer: { available: true, kind: 'exact', remaining: 12 },
      },
    },
  });
  assert(!accountCanSatisfyRequirement(proAccount, opusRequirement), 'Pro accounts must not be allowed to use Opus');
  assert(accountCanSatisfyRequirement(maxAccount, opusRequirement), 'Max accounts should be allowed to use Opus');
  assert(getQuotaItem(maxAccount, 'computer')?.remaining === 12, 'Computer quota helper should prefer live computer quota snapshots');

  const labsRequirement: AccountSelectionRequirements = {
    modelId: 'pplx_beta',
    featureMode: 'studio',
    quotaBucket: 'labs',
    requiredPlan: 'pro',
  };
  const labsExhausted = buildAccount({
    id: 'labs0',
    capabilities: { plan: 'pro', canUseLabs: false },
    quotas: { modes: { labs: { available: false, kind: 'exact', remaining: 0 } } },
  });
  assert(!accountCanSatisfyRequirement(labsExhausted, labsRequirement), 'Labs requests should skip accounts with no labs quota');
  assert(getQuotaItem(labsExhausted, 'labs')?.remaining === 0, 'Quota helper should expose labs remaining count');

  const parsed = parseFileEdits(
    [
      'Update these files:',
      '',
      '```ts path=src/app.ts',
      'export const app = 1;',
      '```',
      '',
      'File: src/styles.css',
      '```css',
      'body { color: red; }',
      '```',
    ].join('\n')
  );
  assert(parsed.length === 2, 'File parser should extract two file edits');
  assert(parsed[0].path === 'src/app.ts', 'File parser should read path= info strings');
  assert(parsed[1].path === 'src/styles.css', 'File parser should infer File: prefixes');

  const fallbackParsed = parseFileEdits('```ts\nconsole.log("hi");\n```', { fallbackPath: 'src/index.ts' });
  assert(fallbackParsed.length === 1 && fallbackParsed[0].path === 'src/index.ts', 'Fallback path should be used for single-file agent replies');

  const capabilityFetcher = new CapabilityFetcher(0);
  capabilityFetcher.noteUsage(maxAccount, 'pro_search');
  assert(maxAccount.quotas?.modes?.pro_search?.remaining === 4, 'Quota usage should decrement exact counters');
  capabilityFetcher.noteQuotaFailure(maxAccount, 'computer');
  assert(maxAccount.capabilities?.canUseComputer === false, 'Computer failures should disable computer access for routing');
  markModelUnavailable(maxAccount, 'claude46sonnetthinking');
  assert(
    !accountCanSatisfyRequirement(maxAccount, {
      modelId: 'claude46sonnetthinking',
      featureMode: 'search',
      quotaBucket: 'pro_search',
      requiredPlan: 'pro',
    }),
    'Blocked model ids should prevent retrying unsupported thinking variants'
  );

  if (process.env.PERPLEXITY_SESSION_TOKEN && process.env.PERPLEXITY_CSRF_TOKEN) {
    const liveAccount = buildAccount({
      sessionToken: process.env.PERPLEXITY_SESSION_TOKEN,
      csrfToken: process.env.PERPLEXITY_CSRF_TOKEN,
      fullCookies: process.env.PERPLEXITY_FULL_COOKIES,
    });
    const liveClient = new PerplexityWebClient(
      liveAccount.sessionToken,
      liveAccount.csrfToken,
      liveAccount.fullCookies
    );
    const valid = await liveClient.validateSession();
    assert(valid, 'Live session validation should succeed when credentials are provided');
    await capabilityFetcher.refreshAccount(liveAccount, true);
    console.log('Live authenticated smoke: passed');
  } else {
    console.log('Live authenticated smoke: skipped (PERPLEXITY_SESSION_TOKEN / PERPLEXITY_CSRF_TOKEN not set)');
  }

  console.log('Source smoke tests: passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
