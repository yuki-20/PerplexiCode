import { AccountPlan, AccountSession } from './types';
import {
  buildModelsFromConfig,
  buildModelsFromAvailableIds,
  compareModels,
  getBaseModelId,
  getFallbackModelCatalog,
  ModelInfo,
} from './modelCatalog';
import { planSatisfiesRequirement } from './capabilityFetcher';

/**
 * Model list provider for the AI model selector shown in Search mode.
 */
export class ModelFetcher {
  getFallbackModels(): ModelInfo[] {
    return this._filterAndSort();
  }

  async getModels(account?: AccountSession): Promise<ModelInfo[]> {
    return this._filterAndSort(account);
  }

  async refresh(account?: AccountSession): Promise<ModelInfo[]> {
    return this._filterAndSort(account);
  }

  private _filterAndSort(account?: AccountSession): ModelInfo[] {
    const plan = account?.capabilities?.plan || 'unknown';
    const accountCatalog = account?.capabilities?.modelsConfig
      ? buildModelsFromConfig(account.capabilities.modelsConfig, plan)
      : account?.capabilities?.availableModelIds?.length
        ? buildModelsFromAvailableIds(account.capabilities.availableModelIds, plan)
        : getFallbackModelCatalog();
    const catalog = account
      ? this._mergeVisibleModels(accountCatalog, getFallbackModelCatalog())
      : accountCatalog;

    return catalog
      .map((model) => {
        const selectable = this._isSelectable(model, account, plan);
        return { ...model, selectable };
      })
      .filter((model) => account ? true : model.requiredPlan !== 'max')
      .sort((left, right) => {
        return compareModels(left, right);
      });
  }

  private _isSelectable(model: ModelInfo, account: AccountSession | undefined, plan: AccountPlan): boolean {
    if (!account) {
      return model.requiredPlan !== 'max';
    }

    if (!planSatisfiesRequirement(plan, model.requiredPlan)) {
      return false;
    }

    if (model.searchMode === 'studio' && account.capabilities?.canUseLabs === false) {
      return false;
    }

    if (model.searchMode === 'asi' && account.capabilities?.canUseComputer === false) {
      return false;
    }

    return true;
  }

  private _mergeVisibleModels(primary: ModelInfo[], visible: ModelInfo[]): ModelInfo[] {
    const merged = new Map<string, ModelInfo>();
    const representedBaseIds = new Set<string>();

    for (const model of primary) {
      merged.set(model.id, model);
      representedBaseIds.add(getBaseModelId(model.id));
    }

    for (const model of visible) {
      const baseId = getBaseModelId(model.id);
      if (!representedBaseIds.has(baseId)) {
        merged.set(model.id, model);
        representedBaseIds.add(baseId);
      }
    }

    return [...merged.values()];
  }
}

export type { ModelInfo } from './modelCatalog';
