import { getQuotaItem, planSatisfiesRequirement } from './capabilityFetcher';
import {
  AccountPlan,
  AccountSession,
  PerplexityRequestMode,
  PerplexitySearchMode,
  QuotaBucket,
} from './types';

export interface RequestProfile {
  searchMode: PerplexitySearchMode;
  requestMode: PerplexityRequestMode;
}

export interface TaskModeInfo {
  id: string;
  label: string;
  category: string;
  description: string;
  quotaBucket: QuotaBucket;
  requiredPlan: AccountPlan;
  supportsThinking: boolean;
  requestProfiles?: RequestProfile[];
  selectable?: boolean;
}

const TASK_MODES: TaskModeInfo[] = [
  {
    id: 'search',
    label: 'Search',
    category: 'Modes',
    description: 'Ask Perplexity with the selected AI model and optional thinking variant.',
    quotaBucket: 'pro_search',
    requiredPlan: 'free',
    supportsThinking: true,
  },
  {
    id: 'labs',
    label: 'Create Files & Apps',
    category: 'Modes',
    description: 'Use Perplexity Create files and apps with Labs quota when your account exposes it.',
    quotaBucket: 'labs',
    requiredPlan: 'pro',
    supportsThinking: false,
    requestProfiles: [
      { searchMode: 'studio', requestMode: 'COPILOT' },
    ],
  },
  {
    id: 'computer',
    label: 'Computer',
    category: 'Modes',
    description: 'Use Perplexity Computer when your account exposes computer access and credits.',
    quotaBucket: 'computer',
    requiredPlan: 'max',
    supportsThinking: false,
    requestProfiles: [
      { searchMode: 'asi', requestMode: 'ASI' },
      { searchMode: 'browser_agent', requestMode: 'ASI' },
    ],
  },
];

export class TaskModeFetcher {
  getFallbackModes(): TaskModeInfo[] {
    return TASK_MODES.map((mode) => ({
      ...mode,
      selectable: mode.id === 'search',
    }));
  }

  getModes(account?: AccountSession): TaskModeInfo[] {
    const plan = account?.capabilities?.plan || 'unknown';

    return TASK_MODES.map((mode) => ({
      ...mode,
      selectable: this._isSelectable(mode, account, plan),
    })).sort(compareTaskModes);
  }

  private _isSelectable(mode: TaskModeInfo, account: AccountSession | undefined, plan: AccountPlan): boolean {
    if (mode.id === 'search') {
      return true;
    }

    if (!account || !planSatisfiesRequirement(plan, mode.requiredPlan)) {
      return false;
    }

    if (mode.quotaBucket === 'computer') {
      return computerQuotaAvailable(account);
    }

    const quota = getQuotaItem(account, mode.quotaBucket);
    return quota ? quota.available : true;
  }
}

export function getTaskModeById(taskModeId: string): TaskModeInfo | undefined {
  return TASK_MODES.find((mode) => mode.id === taskModeId);
}

export function compareTaskModes(left: TaskModeInfo, right: TaskModeInfo): number {
  return getTaskModeOrder(left.id) - getTaskModeOrder(right.id);
}

function getTaskModeOrder(taskModeId: string): number {
  const index = TASK_MODES.findIndex((mode) => mode.id === taskModeId);
  return index === -1 ? TASK_MODES.length : index;
}

function computerQuotaAvailable(account: AccountSession | undefined): boolean {
  if (!account) {
    return false;
  }

  const quota = getQuotaItem(account, 'computer');
  if (quota) {
    return quota.available;
  }

  return account.capabilities?.canUseComputer !== false;
}
