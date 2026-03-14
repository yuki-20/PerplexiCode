import * as vscode from 'vscode';
import { getModelLabel, modelSupportsThinking } from '../api/modelCatalog';
import { ModelInfo } from '../api/modelFetcher';
import { TaskModeInfo } from '../api/taskModeCatalog';

/**
 * Status bar controller for the active account pool and selected model.
 */
export class StatusBarManager {
  private readonly statusBarItem: vscode.StatusBarItem;
  private currentModelId = 'turbo';
  private currentTaskModeId = 'search';
  private thinkingEnabled = false;
  private isStreaming = false;
  private accountCount = 0;
  private activeAccountCount = 0;
  private activeAccountAlias = '';
  private models: ModelInfo[] = [];
  private taskModes: TaskModeInfo[] = [];

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'perplexicode.selectModel';
    this.updateDisplay();
    this.statusBarItem.show();
  }

  setModels(models: ModelInfo[]): void {
    this.models = models;
    if (models.length > 0 && !models.find((model) => model.id === this.currentModelId && model.selectable !== false)) {
      this.currentModelId = models.find((model) => model.selectable !== false)?.id || models[0].id;
      this.thinkingEnabled = false;
    }
    if (!modelSupportsThinking(this.currentModelId)) {
      this.thinkingEnabled = false;
    }
    this.updateDisplay();
  }

  setTaskModes(taskModes: TaskModeInfo[]): void {
    this.taskModes = taskModes;
    if (taskModes.length > 0 && !taskModes.find((mode) => mode.id === this.currentTaskModeId && mode.selectable !== false)) {
      this.currentTaskModeId = taskModes.find((mode) => mode.selectable !== false)?.id || taskModes[0].id;
    }
    if (!this.currentTaskModeSupportsThinking()) {
      this.thinkingEnabled = false;
    }
    this.updateDisplay();
  }

  setAccountInfo(total: number, active: number, currentAlias?: string): void {
    this.accountCount = total;
    this.activeAccountCount = active;
    if (currentAlias) {
      this.activeAccountAlias = currentAlias;
    }
    this.updateDisplay();
  }

  setModel(modelId: string): void {
    if (this.models.length > 0 && !this.models.find((model) => model.id === modelId && model.selectable !== false)) {
      return;
    }
    this.currentModelId = modelId;
    if (!modelSupportsThinking(modelId)) {
      this.thinkingEnabled = false;
    }
    this.updateDisplay();
  }

  setTaskMode(taskModeId: string): void {
    if (this.taskModes.length > 0 && !this.taskModes.find((mode) => mode.id === taskModeId && mode.selectable !== false)) {
      return;
    }
    this.currentTaskModeId = taskModeId;
    if (!this.currentTaskModeSupportsThinking()) {
      this.thinkingEnabled = false;
    }
    this.updateDisplay();
  }

  setThinking(enabled: boolean): void {
    this.thinkingEnabled = this.currentTaskModeSupportsThinking() && modelSupportsThinking(this.currentModelId) && enabled;
    this.updateDisplay();
  }

  getModel(): string {
    return this.currentModelId;
  }

  getTaskMode(): string {
    return this.currentTaskModeId;
  }

  isThinkingEnabled(): boolean {
    return this.thinkingEnabled && this.currentTaskModeSupportsThinking() && modelSupportsThinking(this.currentModelId);
  }

  setStreaming(streaming: boolean, accountAlias?: string): void {
    this.isStreaming = streaming;
    if (accountAlias) {
      this.activeAccountAlias = accountAlias;
    }
    this.updateDisplay();
  }

  async showModelPicker(): Promise<string | undefined> {
    if (this.models.length === 0 && this.taskModes.length === 0) {
      vscode.window.showWarningMessage('PerplexiCode: No selectors available. Add an account first.');
      return undefined;
    }

    const items: (vscode.QuickPickItem & { modelId?: string; taskModeId?: string })[] = [];

    if (this.taskModes.length > 0) {
      items.push({ label: 'Modes', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem & { taskModeId?: string });
      for (const taskMode of this.taskModes) {
        const locked = taskMode.selectable === false;
        items.push({
          label: locked
            ? `$(lock) ${taskMode.label}`
            : taskMode.id === this.currentTaskModeId ? `$(check) ${taskMode.label}` : `     ${taskMode.label}`,
          description: locked
            ? `Requires ${taskMode.requiredPlan.toUpperCase()} plan. ${taskMode.description}`
            : taskMode.description,
          taskModeId: locked ? undefined : taskMode.id,
        });
      }
    }

    const categories = [...new Set(this.models.map((model) => model.category))];

    for (const category of categories) {
      items.push({ label: category, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem & { modelId?: string });
      for (const model of this.models.filter((entry) => entry.category === category)) {
        const locked = model.selectable === false;
        items.push({
          label: locked
            ? `$(lock) ${model.label}`
            : model.id === this.currentModelId ? `$(check) ${model.label}` : `     ${model.label}`,
          description: locked
            ? `Requires ${model.requiredPlan.toUpperCase()} plan. ${model.description}`
            : model.description,
          modelId: locked ? undefined : model.id,
        });
      }
    }

    const selected = await vscode.window.showQuickPick(items, {
      title: 'PerplexiCode: Mode and Model Selection',
      placeHolder: 'Select a Perplexity task mode or AI model',
    });

    if (selected?.taskModeId) {
      this.setTaskMode(selected.taskModeId);
      return selected.taskModeId;
    }

    if (selected?.modelId) {
      this.setModel(selected.modelId);
      return selected.modelId;
    }
    return undefined;
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }

  private updateDisplay(): void {
    if (this.accountCount === 0) {
      this.statusBarItem.text = '$(account) PerplexiCode: No Accounts';
      this.statusBarItem.tooltip = 'Click to add a Perplexity account';
      this.statusBarItem.command = 'perplexicode.addAccount';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }

    this.statusBarItem.backgroundColor = undefined;
    const modelLabel = getModelLabel(this.currentModelId, this.isThinkingEnabled());
    const taskModeLabel = this.taskModes.find((mode) => mode.id === this.currentTaskModeId)?.label || 'Search';
    const selectionLabel = this.currentTaskModeId === 'search' ? modelLabel : `${taskModeLabel} · ${modelLabel}`;

    if (this.isStreaming) {
      this.statusBarItem.text = `$(sync~spin) ${this.activeAccountAlias || 'Streaming'}...`;
      this.statusBarItem.tooltip = `Streaming via ${this.activeAccountAlias}\nMode: ${taskModeLabel}\nModel: ${modelLabel}\nAccounts: ${this.activeAccountCount}/${this.accountCount} active`;
      this.statusBarItem.command = 'perplexicode.selectModel';
      return;
    }

    this.statusBarItem.text = `$(sparkle) ${selectionLabel} | ${this.activeAccountCount}/${this.accountCount}`;
    this.statusBarItem.tooltip = `Mode: ${taskModeLabel}\nModel: ${modelLabel}\nAccounts: ${this.activeAccountCount}/${this.accountCount} active`;
    this.statusBarItem.command = 'perplexicode.selectModel';
  }

  private currentTaskModeSupportsThinking(): boolean {
    return this.taskModes.find((mode) => mode.id === this.currentTaskModeId)?.supportsThinking !== false;
  }
}
