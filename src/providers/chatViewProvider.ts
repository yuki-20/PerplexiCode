import * as path from 'path';
import * as vscode from 'vscode';
import { ChromeCookieReader } from '../api/cookieReader';
import { parseFileEdits, ParsedFileEdit } from '../agents/fileEditParser';
import {
  accountCanSatisfyRequirement,
  CapabilityFetcher,
  formatQuotaSummary,
  getQuotaItem,
  markModelUnavailable,
} from '../api/capabilityFetcher';
import {
  compareModels,
  setRuntimeModelCatalog,
  getBaseModelId,
  getDefaultSourcesForModel,
  getModelById,
  getModelLabel,
  getResolvedModelId,
  isThinkingModelId,
  ModelInfo,
  modelSupportsThinking,
} from '../api/modelCatalog';
import { ModelFetcher } from '../api/modelFetcher';
import { PerplexityWebClient } from '../api/perplexityClient';
import { RotationEngine } from '../api/rotationEngine';
import { compareTaskModes, getTaskModeById, TaskModeFetcher, TaskModeInfo } from '../api/taskModeCatalog';
import { AccountSelectionRequirements, AccountSession, StreamResponseMeta } from '../api/types';
import { ContextBuilder, ContextOptions } from '../context/contextBuilder';
import { FileReader } from '../context/fileReader';
import { AccountManager } from '../storage/accountManager';
import { StatusBarManager } from '../ui/statusBar';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ApplySummary {
  applied: number;
  failed: number;
  files: string[];
  message: string;
}

/**
 * Chat webview provider with multi-account routing, quotas, and agent apply.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'perplexicode.chatView';

  private webviewView?: vscode.WebviewView;
  private conversationHistory: ConversationMessage[] = [];
  private activeAbortController?: AbortController;
  private agentModeEnabled = false;
  private workspaceModeEnabled = true;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly accountManager: AccountManager,
    private readonly rotationEngine: RotationEngine,
    private readonly modelFetcher: ModelFetcher,
    private readonly taskModeFetcher: TaskModeFetcher,
    private readonly capabilityFetcher: CapabilityFetcher,
    private readonly fileReader: FileReader,
    private readonly contextBuilder: ContextBuilder,
    private readonly statusBar: StatusBarManager
  ) {}

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): Promise<void> {
    this.webviewView = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'webview-ui'),
      ],
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          await this._sendInitialState();
          break;
        case 'sendMessage':
          await this.handleSendMessage(message.text, {
            ...(message.contextOptions || {}),
            agentMode: this.agentModeEnabled,
          });
          break;
        case 'changeModel':
          this.statusBar.setModel(message.model);
          this.statusBar.setThinking(false);
          this._pushSelectionState();
          break;
        case 'changeTaskMode':
          this.statusBar.setTaskMode(message.taskMode);
          if (this.statusBar.getTaskMode() !== 'search') {
            this.statusBar.setThinking(false);
          }
          this._pushSelectionState();
          break;
        case 'toggleThinking':
          this.statusBar.setThinking(Boolean(message.enabled));
          this._pushSelectionState();
          break;
        case 'toggleAgentMode':
          this.agentModeEnabled = Boolean(message.enabled);
          this._pushSelectionState();
          break;
        case 'toggleWorkspaceMode':
          this.workspaceModeEnabled = Boolean(message.enabled);
          this._pushSelectionState();
          break;
        case 'refreshAccountData':
          await this.refreshModels(true);
          break;
        case 'stopStreaming':
          this._handleStopStreaming();
          break;
        case 'copyCode':
          await vscode.env.clipboard.writeText(message.code);
          vscode.window.showInformationMessage('Code copied to clipboard.');
          break;
        case 'insertCode':
          await this._insertCodeAtCursor(message.code);
          break;
        case 'applyFiles':
          await this._applyFileEdits(message.edits || [], false);
          break;
        case 'newConversation':
          this.conversationHistory = [];
          break;
        case 'getAccounts':
          this._sendAccountsList();
          break;
        case 'removeAccount':
          await this.accountManager.removeAccount(message.accountId);
          await this.refreshModels(true);
          break;
        case 'toggleAccount':
          await this.accountManager.toggleAccount(message.accountId);
          await this.refreshModels(true);
          break;
        case 'addAccount':
          void vscode.commands.executeCommand('perplexicode.addAccount');
          break;
        case 'signOutAll':
          for (const account of this.accountManager.getAccounts()) {
            await this.accountManager.removeAccount(account.id);
          }
          await this.refreshModels(true);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this._handleStopStreaming();
    });
  }

  async sendSelectionQuery(query?: string): Promise<void> {
    const selection = this.fileReader.readSelection();
    if (!selection && !query) {
      vscode.window.showWarningMessage('PerplexiCode: No text selected in the editor.');
      return;
    }

    let userMessage = query;
    if (!userMessage && selection) {
      userMessage = `Explain this code and suggest improvements:\n\n\`\`\`${selection.language}\n${selection.content}\n\`\`\``;
    }

    if (this.webviewView) {
      this.webviewView.show?.(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));

    if (userMessage) {
      await this.handleSendMessage(userMessage, {
        selectedText: true,
        includeCurrentFile: this.workspaceModeEnabled,
        includeProjectTree: this.workspaceModeEnabled,
        agentMode: this.agentModeEnabled,
      });
    }
  }

  async refreshModels(force = false): Promise<void> {
    const accounts = this.accountManager.getAccounts();
    await this.capabilityFetcher.refreshAccounts(accounts, force);
    await this.accountManager.saveMetas();

    const models = await this._getAvailableModels();
    const taskModes = this._getAvailableTaskModes();

    setRuntimeModelCatalog(models);
    this.statusBar.setTaskModes(taskModes);
    this.statusBar.setModels(models);
    this._updateAccountStatus();
    this._postMessage({
      type: 'modelsUpdated',
      models: models.map((model) => this._toWebviewModel(model)),
      taskModes: taskModes.map((taskMode) => this._toWebviewTaskMode(taskMode)),
    });
    this._sendAccountsList();
    this._pushSelectionState();
  }

  private async handleSendMessage(text: string, contextOptions?: ContextOptions): Promise<void> {
    const accounts = this.accountManager.getAccounts();
    // Fast quota-only refresh — always gets fresh data from /rest/rate-limit/all
    await this.capabilityFetcher.refreshQuotas(accounts);
    await this.accountManager.saveMetas();

    const taskMode = getTaskModeById(this.statusBar.getTaskMode()) || this._getAvailableTaskModes().find((mode) => mode.id === 'search');
    const baseModelId = this.statusBar.getModel();
    const thinkingEnabled = Boolean(taskMode?.supportsThinking) && this.statusBar.isThinkingEnabled();
    const resolvedModelId = getResolvedModelId(baseModelId, thinkingEnabled);
    const model = getModelById(resolvedModelId) || getModelById(baseModelId);
    if (!model || !taskMode) {
      this._postMessage({ type: 'error', message: 'The selected model is no longer available.' });
      return;
    }

    const primaryRequestProfile = taskMode.requestProfiles?.[0] || {
      searchMode: model.searchMode,
      requestMode: model.requestMode,
    };
    const requiredPlan = taskMode.id === 'search'
      ? model.requiredPlan
      : stricterPlan(model.requiredPlan, taskMode.requiredPlan);
    const requirement: AccountSelectionRequirements = {
      modelId: resolvedModelId,
      featureMode: primaryRequestProfile.searchMode,
      quotaBucket: taskMode.id === 'search' ? model.quotaBucket : taskMode.quotaBucket,
      requiredPlan,
    };

    let account = this.rotationEngine.selectAccount(accounts, requirement);
    let activeModelId = resolvedModelId;
    let activeModel = model;
    let activeRequirement = requirement;
    let activeRequestProfile = primaryRequestProfile;

    // If no account can serve the selected model, fall back to turbo (Best)
    if (!account && resolvedModelId !== 'turbo' && taskMode.id === 'search') {
      const turboModel = getModelById('turbo');
      if (turboModel) {
        const turboRequirement: AccountSelectionRequirements = {
          modelId: 'turbo',
          featureMode: 'search',
          quotaBucket: 'free_queries',
          requiredPlan: 'free',
        };
        const turboAccount = this.rotationEngine.selectAccount(accounts, turboRequirement);
        if (turboAccount) {
          account = turboAccount;
          activeModelId = 'turbo';
          activeModel = turboModel;
          activeRequirement = turboRequirement;
          activeRequestProfile = { searchMode: 'search', requestMode: 'CONCISE' };
          this._postMessage({
            type: 'info',
            message: `${model.label} is not available right now. Using ${turboModel.label} model instead.`,
          });
        }
      }
    }

    if (!account) {
      const selectionLabel = taskMode.id === 'search' ? model.label : `${taskMode.label} with ${model.label}`;
      this._postMessage({ type: 'error', message: this._buildNoAccountMessage(accounts, selectionLabel, requirement) });
      this._sendAccountsList();
      return;
    }

    const query = await this.contextBuilder.buildContextString(
      text,
      this.conversationHistory,
      contextOptions || {
        includeCurrentFile: this.workspaceModeEnabled,
        includeProjectTree: this.workspaceModeEnabled,
        agentMode: this.agentModeEnabled,
      }
    );

    this.conversationHistory.push({ role: 'user', content: text });
    const displayLabel = taskMode.id === 'search'
      ? getModelLabel(activeModelId)
      : `${taskMode.label} · ${getModelLabel(baseModelId)}`;
    this._postMessage({ type: 'userMessage', text });
    this.statusBar.setStreaming(true, account.alias);
    this._postMessage({
      type: 'streamStart',
      accountAlias: account.alias,
      modelLabel: displayLabel,
      taskModeLabel: taskMode.label,
    });

    await this._streamWithAccount({
      account,
      query,
      requestedModelId: activeModelId,
      modelLabel: displayLabel,
      taskModeLabel: taskMode.label,
      modelRequirement: activeRequirement,
      requestProfiles: taskMode.requestProfiles || [{
        searchMode: activeModel.searchMode,
        requestMode: activeModel.requestMode,
      }],
      requestProfileIndex: 0,
      requestOptions: {
        sources: getDefaultSourcesForModel(activeModelId),
        searchMode: activeRequestProfile.searchMode,
        requestMode: activeRequestProfile.requestMode,
      },
      originalUserText: text,
      agentMode: Boolean(contextOptions?.agentMode),
      retryAccounts: accounts,
    });
  }

  private async _streamWithAccount(options: {
    account: AccountSession;
    query: string;
    requestedModelId: string;
    modelLabel: string;
    taskModeLabel: string;
    modelRequirement: AccountSelectionRequirements;
    requestProfiles: {
      searchMode: AccountSelectionRequirements['featureMode'];
      requestMode: 'CONCISE' | 'COPILOT' | 'ASI';
    }[];
    requestProfileIndex: number;
    requestOptions: {
      sources: ('web' | 'scholar' | 'social')[];
      searchMode: AccountSelectionRequirements['featureMode'];
      requestMode: 'CONCISE' | 'COPILOT' | 'ASI';
    };
    originalUserText: string;
    agentMode: boolean;
    retryAccounts: AccountSession[];
  }): Promise<void> {
    const client = new PerplexityWebClient(
      options.account.sessionToken,
      options.account.csrfToken,
      options.account.fullCookies
    );

    let streamedText = '';
    let latestMeta: StreamResponseMeta | undefined;

    this.activeAbortController = client.streamQuery(
      options.query,
      options.requestedModelId,
      {
        onChunk: (content) => {
          streamedText += content;
          this._postMessage({ type: 'streamChunk', content });
        },
        onCitations: (citations) => {
          this._postMessage({ type: 'citations', citations });
        },
        onMeta: (meta) => {
          latestMeta = { ...(latestMeta || {
            requestedModel: options.requestedModelId,
            resolvedModel: options.requestedModelId,
            displayModel: options.modelLabel,
            searchMode: options.requestOptions.searchMode,
            mode: options.requestOptions.requestMode,
          }), ...meta };
          this._postMessage({
            type: 'streamMeta',
            modelLabel: latestMeta.displayModel,
            accountAlias: options.account.alias,
            taskModeLabel: options.taskModeLabel,
          });
        },
        onDone: (content, meta) => {
          latestMeta = meta;
          void this._finalizeStream(
            options.account,
            streamedText || content,
            meta,
            options.modelRequirement,
            options.agentMode,
            options.taskModeLabel
          );
        },
        onError: (error) => {
          void this._handleStreamError(error, options, streamedText, latestMeta);
        },
      },
      options.requestOptions
    );
  }

  private async _finalizeStream(
    account: AccountSession,
    responseText: string,
    meta: StreamResponseMeta,
    requirement: AccountSelectionRequirements,
    agentMode: boolean,
    taskModeLabel: string
  ): Promise<void> {
    this.statusBar.setStreaming(false);
    this.rotationEngine.markUsed(account);
    this.capabilityFetcher.noteUsage(account, requirement.quotaBucket);
    await this.accountManager.saveMetas();

    const finalLabel = meta.displayModel || getModelLabel(meta.resolvedModel || meta.requestedModel);
    const finalText = this._appendPreparedBy(responseText, finalLabel);
    this.conversationHistory.push({ role: 'assistant', content: finalText });

    const currentFile = this.fileReader.readCurrentFile();
    const fallbackPath = currentFile?.relativePath || currentFile?.absolutePath;
    const fileEdits = parseFileEdits(finalText, { fallbackPath: agentMode ? fallbackPath : undefined });
    let appliedSummary: ApplySummary | undefined;

    if (agentMode && fileEdits.length > 0) {
      appliedSummary = await this._applyFileEdits(fileEdits, true);
    }

    this._updateAccountStatus();
    this._sendAccountsList();
    this._pushSelectionState();
    this._postMessage({
      type: 'streamEnd',
      accountAlias: account.alias,
      finalText,
      modelLabel: finalLabel,
      taskModeLabel,
      fileEdits,
      appliedSummary,
    });
    this.activeAbortController = undefined;
  }

  private async _handleStreamError(
    error: Error,
    options: {
      account: AccountSession;
      query: string;
      requestedModelId: string;
      modelLabel: string;
      taskModeLabel: string;
      modelRequirement: AccountSelectionRequirements;
      requestProfiles: {
        searchMode: AccountSelectionRequirements['featureMode'];
        requestMode: 'CONCISE' | 'COPILOT' | 'ASI';
      }[];
      requestProfileIndex: number;
      requestOptions: {
        sources: ('web' | 'scholar' | 'social')[];
        searchMode: AccountSelectionRequirements['featureMode'];
        requestMode: 'CONCISE' | 'COPILOT' | 'ASI';
      };
      originalUserText: string;
      agentMode: boolean;
      retryAccounts: AccountSession[];
    },
    streamedText: string,
    meta?: StreamResponseMeta
  ): Promise<void> {
    this.statusBar.setStreaming(false);

    const lowered = error.message.toLowerCase();
    const isExpired = lowered.includes('session expired')
      || lowered.includes('re-login')
      || lowered.includes('sign in again')
      || lowered.includes('authentication');
    const isRateLimit = lowered.includes('rate limited') || lowered.includes('429');
    const isQuota = lowered.includes('quota');
    const isAccessDenied = lowered.includes('rejected by perplexity')
      || lowered.includes('not available for the current account')
      || lowered.includes('access denied')
      || lowered.includes('forbidden');
    const canRetryProfile = isAccessDenied && options.requestProfileIndex < options.requestProfiles.length - 1;
    const isThinkingRequest = isThinkingModelId(options.requestedModelId);
    const baseModelId = getBaseModelId(options.requestedModelId);

    if (isExpired) {
      this.rotationEngine.markExpired(options.account);

      // Try to silently re-import cookies from the browser
      const refreshed = await this._tryAutoRefreshSession(options.account);
      if (refreshed) {
        // Reset stream and retry with fresh tokens
        if (streamedText) {
          this._postMessage({ type: 'streamReset' });
        }
        this._postMessage({
          type: 'info',
          message: `Session refreshed for ${options.account.alias}. Retrying...`,
        });
        this.statusBar.setStreaming(true, options.account.alias);
        this._postMessage({
          type: 'streamMeta',
          modelLabel: options.modelLabel,
          accountAlias: options.account.alias,
          taskModeLabel: options.taskModeLabel,
        });
        this.activeAbortController = undefined;
        await this._streamWithAccount(options);
        return;
      }
    } else if (isRateLimit) {
      this.rotationEngine.markFailed(options.account, true);
    } else if (isQuota) {
      this.capabilityFetcher.noteQuotaFailure(options.account, options.modelRequirement.quotaBucket);
    } else if (isAccessDenied && !canRetryProfile) {
      markModelUnavailable(options.account, options.requestedModelId);
    } else if (!isAccessDenied) {
      this.rotationEngine.markFailed(options.account, false);
    }

    await this.accountManager.saveMetas();

    if (canRetryProfile) {
      if (streamedText) {
        this._postMessage({ type: 'streamReset' });
      }
      const nextRequestProfileIndex = options.requestProfileIndex + 1;
      const nextRequestProfile = options.requestProfiles[nextRequestProfileIndex];
      this._postMessage({
        type: 'info',
        message: `${options.taskModeLabel} was rejected on the primary route. Retrying the alternate Perplexity route on ${options.account.alias}.`,
      });
      this.statusBar.setStreaming(true, options.account.alias);
      this._postMessage({
        type: 'streamMeta',
        modelLabel: meta?.displayModel || options.modelLabel,
        accountAlias: options.account.alias,
        taskModeLabel: options.taskModeLabel,
      });
      this.activeAbortController = undefined;
      await this._streamWithAccount({
        ...options,
        requestProfileIndex: nextRequestProfileIndex,
        requestOptions: {
          ...options.requestOptions,
          searchMode: nextRequestProfile.searchMode,
          requestMode: nextRequestProfile.requestMode,
        },
      });
      return;
    }

    const failover = this.rotationEngine.getFailoverAccount(
      options.retryAccounts,
      options.account.id,
      options.modelRequirement
    );

    if (failover && (isExpired || isRateLimit || isQuota || isAccessDenied)) {
      if (streamedText) {
        this._postMessage({ type: 'streamReset' });
      }
      this._postMessage({
        type: 'info',
        message: `${options.account.alias} ${isExpired
          ? 'needs a fresh login'
          : isQuota
            ? 'has no quota left'
            : isRateLimit
              ? 'is rate limited'
              : `could not use ${options.modelLabel}`}. Switching to ${failover.alias}.`,
      });
      this.statusBar.setStreaming(true, failover.alias);
      this._postMessage({
        type: 'streamMeta',
        modelLabel: meta?.displayModel || options.modelLabel,
        accountAlias: failover.alias,
        taskModeLabel: options.taskModeLabel,
      });
      this.activeAbortController = undefined;
      await this._streamWithAccount({
        ...options,
        account: failover,
      });
      return;
    }

    if (isAccessDenied && isThinkingRequest && baseModelId !== options.requestedModelId) {
      const fallbackModel = getModelById(baseModelId);
      if (fallbackModel) {
        const fallbackRequirement: AccountSelectionRequirements = {
          modelId: baseModelId,
          featureMode: fallbackModel.searchMode,
          quotaBucket: fallbackModel.quotaBucket,
          requiredPlan: fallbackModel.requiredPlan,
        };
        const fallbackLabel = getModelLabel(baseModelId);

        if (streamedText) {
          this._postMessage({ type: 'streamReset' });
        }

        this.statusBar.setThinking(false);
        this._pushSelectionState();
        this._postMessage({
          type: 'info',
          message: `Thinking is not available for ${fallbackModel.label} on ${options.account.alias}. Retrying with the normal variant.`,
        });
        this.statusBar.setStreaming(true, options.account.alias);
        this._postMessage({
          type: 'streamMeta',
          modelLabel: fallbackLabel,
          accountAlias: options.account.alias,
          taskModeLabel: options.taskModeLabel,
        });
        this.activeAbortController = undefined;
        await this._streamWithAccount({
          ...options,
          requestedModelId: baseModelId,
          modelLabel: fallbackLabel,
          modelRequirement: fallbackRequirement,
          requestOptions: {
            sources: getDefaultSourcesForModel(baseModelId),
            searchMode: fallbackModel.searchMode,
            requestMode: fallbackModel.requestMode,
          },
        });
        return;
      }
    }

    // Safety fallback: try CONCISE mode if currently COPILOT (some models only work in CONCISE)
    if (isAccessDenied && options.requestOptions.requestMode === 'COPILOT') {
      if (streamedText) {
        this._postMessage({ type: 'streamReset' });
      }

      this._postMessage({
        type: 'info',
        message: `${options.modelLabel} was denied in Pro mode. Retrying with standard mode on ${options.account.alias}.`,
      });
      this.statusBar.setStreaming(true, options.account.alias);
      this._postMessage({
        type: 'streamMeta',
        modelLabel: options.modelLabel,
        accountAlias: options.account.alias,
        taskModeLabel: options.taskModeLabel,
      });
      this.activeAbortController = undefined;
      await this._streamWithAccount({
        ...options,
        requestOptions: {
          ...options.requestOptions,
          requestMode: 'CONCISE',
        },
      });
      return;
    }

    // Last resort: fall back to 'turbo' (Best) model which always works
    if ((isAccessDenied || isRateLimit || isQuota) && options.requestedModelId !== 'turbo') {
      if (streamedText) {
        this._postMessage({ type: 'streamReset' });
      }

      const turboModel = getModelById('turbo');
      const turboLabel = turboModel ? turboModel.label : 'Best';

      this._postMessage({
        type: 'info',
        message: `${options.modelLabel} is not available. Falling back to ${turboLabel} model on ${options.account.alias}.`,
      });
      this.statusBar.setStreaming(true, options.account.alias);
      this._postMessage({
        type: 'streamMeta',
        modelLabel: turboLabel,
        accountAlias: options.account.alias,
        taskModeLabel: options.taskModeLabel,
      });
      this.activeAbortController = undefined;
      await this._streamWithAccount({
        ...options,
        requestedModelId: 'turbo',
        modelLabel: turboLabel,
        modelRequirement: {
          modelId: 'turbo',
          featureMode: 'search',
          quotaBucket: 'free_queries',
          requiredPlan: 'free',
        },
        requestOptions: {
          sources: ['web'],
          searchMode: 'search',
          requestMode: 'CONCISE',
        },
      });
      return;
    }

    this._updateAccountStatus();
    this._sendAccountsList();
    this._pushSelectionState();
    this._postMessage({ type: 'error', message: error.message });
    this.activeAbortController = undefined;
  }

  /**
   * Try to silently refresh session by re-importing cookies from the browser.
   * Returns true if refresh succeeded and the account was updated.
   */
  private async _tryAutoRefreshSession(account: AccountSession): Promise<boolean> {
    try {
      const cookieReader = new ChromeCookieReader();

      // Can't read if browser is running (SQLite locks)
      if (cookieReader.isBrowserRunning()) {
        return false;
      }

      const cookies = await cookieReader.getPerplexityCookies();
      if (!cookies) {
        return false;
      }

      // Update the account with fresh tokens
      account.sessionToken = cookies.sessionToken;
      account.csrfToken = cookies.csrfToken;
      account.status = 'active';
      account.errorCount = 0;
      account.cooldownUntil = undefined;
      account.capabilities = { ...account.capabilities, plan: account.capabilities?.plan || 'unknown', blockedModelIds: undefined } as any;

      // Persist the new tokens
      await this.accountManager.updateTokens(account.id, cookies.sessionToken, cookies.csrfToken);

      return true;
    } catch {
      return false;
    }
  }

  private _handleStopStreaming(): void {
    if (!this.activeAbortController) {
      return;
    }

    this.activeAbortController.abort();
    this.activeAbortController = undefined;
    this.statusBar.setStreaming(false);
    this._postMessage({
      type: 'streamEnd',
      finalText: '',
      modelLabel: getModelLabel(this.statusBar.getModel(), this.statusBar.isThinkingEnabled()),
    });
  }

  private async _insertCodeAtCursor(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor.');
      return;
    }

    await editor.edit((builder) => {
      if (editor.selection.isEmpty) {
        builder.insert(editor.selection.active, code);
      } else {
        builder.replace(editor.selection, code);
      }
    });
  }

  private async _applyFileEdits(edits: ParsedFileEdit[], autoApply: boolean): Promise<ApplySummary> {
    const encoder = new TextEncoder();
    const applied: string[] = [];
    let failed = 0;

    for (const edit of edits) {
      try {
        const uri = this._resolveEditUri(edit.path);
        if (!uri) {
          failed += 1;
          continue;
        }

        const directory = vscode.Uri.file(path.dirname(uri.fsPath));
        await vscode.workspace.fs.createDirectory(directory);
        await vscode.workspace.fs.writeFile(uri, encoder.encode(edit.content));
        applied.push(edit.path);
      } catch {
        failed += 1;
      }
    }

    const summary: ApplySummary = {
      applied: applied.length,
      failed,
      files: applied,
      message: applied.length > 0
        ? `Applied ${applied.length} file${applied.length === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}.`
        : 'No files were applied.',
    };

    if (applied.length > 0 && !autoApply) {
      vscode.window.showInformationMessage(summary.message);
    } else if (failed > 0 && !autoApply) {
      vscode.window.showWarningMessage(summary.message);
    }

    return summary;
  }

  private _resolveEditUri(targetPath: string): vscode.Uri | undefined {
    if (path.isAbsolute(targetPath)) {
      return vscode.Uri.file(targetPath);
    }

    const workspaceRoot = this.fileReader.getWorkspaceRoot();
    if (!workspaceRoot) {
      return undefined;
    }

    return vscode.Uri.joinPath(workspaceRoot, targetPath);
  }

  private _appendPreparedBy(text: string, modelLabel: string): string {
    const preparedByLine = `\n\nPrepared by "${modelLabel}"`;
    return text.trimEnd().endsWith(preparedByLine.trim()) ? text.trimEnd() : `${text.trimEnd()}${preparedByLine}`;
  }

  private _buildNoAccountMessage(
    accounts: AccountSession[],
    modelLabel: string,
    requirement: AccountSelectionRequirements
  ): string {
    if (!this.accountManager.hasAccounts()) {
      return 'No accounts configured. Use "PerplexiCode: Add Account" to connect a Perplexity account.';
    }

    const usableAccounts = accounts.filter((account) => account.status === 'active' || account.status === 'rate_limited');
    if (usableAccounts.length === 0) {
      return 'All accounts are unavailable. Reconnect an account or wait for cooldowns to clear.';
    }

    if (requirement.requiredPlan === 'max') {
      return `${modelLabel} requires Max access. None of your accounts currently expose that tier.`;
    }

    if (isThinkingModelId(requirement.modelId)) {
      return `${modelLabel} is not currently available on your connected accounts. Try the normal variant or refresh account data.`;
    }

    return `No active account has quota left for ${modelLabel}. Refresh quotas or add another account.`;
  }

  private _updateAccountStatus(): void {
    const accounts = this.accountManager.getAccounts();
    this.statusBar.setAccountInfo(accounts.length, this.accountManager.getActiveCount());
  }

  private async _sendInitialState(): Promise<void> {
    await this.refreshModels();
    const taskModes = this._getAvailableTaskModes();
    const models = await this._getAvailableModels();

    this._postMessage({
      type: 'initialState',
      hasAccounts: this.accountManager.hasAccounts(),
      model: this.statusBar.getModel(),
      taskMode: this.statusBar.getTaskMode(),
      taskModeLabel: taskModes.find((taskMode) => taskMode.id === this.statusBar.getTaskMode())?.label || 'Search',
      taskModes: taskModes.map((taskMode) => this._toWebviewTaskMode(taskMode)),
      models: models.map((model) => this._toWebviewModel(model)),
      accountCount: this.accountManager.getAccounts().length,
      activeAccountCount: this.accountManager.getActiveCount(),
      agentModeEnabled: this.agentModeEnabled,
      thinkingEnabled: this.statusBar.isThinkingEnabled(),
      thinkingAvailable: this.statusBar.getTaskMode() === 'search' && modelSupportsThinking(this.statusBar.getModel()),
      workspaceModeEnabled: this.workspaceModeEnabled,
      accounts: this._serializeAccounts(),
    });

    this._pushSelectionState();
  }

  private _pushSelectionState(): void {
    const selectedTaskModeId = this.statusBar.getTaskMode();
    const taskMode = getTaskModeById(selectedTaskModeId) || this._getAvailableTaskModes().find((mode) => mode.id === 'search');
    const selectedModelId = this.statusBar.getModel();
    const thinkingEnabled = Boolean(taskMode?.supportsThinking) && this.statusBar.isThinkingEnabled();
    const resolvedModelId = getResolvedModelId(selectedModelId, thinkingEnabled);
    const model = getModelById(resolvedModelId) || getModelById(selectedModelId);
    const supportsThinking = modelSupportsThinking(selectedModelId);
    const requirement = model ? {
      modelId: resolvedModelId,
      featureMode: taskMode?.requestProfiles?.[0]?.searchMode || model.searchMode,
      quotaBucket: taskMode?.id === 'search' ? model.quotaBucket : (taskMode?.quotaBucket || model.quotaBucket),
      requiredPlan: taskMode?.id === 'search'
        ? model.requiredPlan
        : stricterPlan(model.requiredPlan, taskMode?.requiredPlan || model.requiredPlan),
    } : undefined;
    const thinkingModelId = getResolvedModelId(selectedModelId, true);
    const thinkingRequirement = taskMode?.supportsThinking !== false && supportsThinking && model
      ? {
        modelId: thinkingModelId,
        featureMode: model.searchMode,
        quotaBucket: model.quotaBucket,
        requiredPlan: model.requiredPlan,
      }
      : undefined;

    const availableAccounts = requirement
      ? this.accountManager.getAccounts().filter((account) => accountCanSatisfyRequirement(account, requirement)).length
      : this.accountManager.getActiveCount();
    const thinkingAvailable = thinkingRequirement
      ? this.accountManager.getAccounts().some((account) => accountCanSatisfyRequirement(account, thinkingRequirement))
      : false;

    this._postMessage({
      type: 'selectionState',
      taskMode: selectedTaskModeId,
      taskModeLabel: taskMode?.label || 'Search',
      model: selectedModelId,
      modelLabel: getModelLabel(resolvedModelId),
      thinkingEnabled,
      thinkingAvailable,
      agentModeEnabled: this.agentModeEnabled,
      workspaceModeEnabled: this.workspaceModeEnabled,
      availableAccountCount: availableAccounts,
      selectedQuota: requirement
        ? formatQuotaSummary(this._bestQuotaForRequirement(requirement))
        : 'Unknown',
    });
  }

  private _bestQuotaForRequirement(requirement: AccountSelectionRequirements) {
    for (const account of this.accountManager.getAccounts()) {
      const quota = getQuotaItem(account, requirement.quotaBucket);
      if (quota?.available) {
        return quota;
      }
    }
    return undefined;
  }

  private _postMessage(message: any): void {
    this.webviewView?.webview.postMessage(message);
  }

  private _sendAccountsList(): void {
    this._postMessage({ type: 'accountsList', accounts: this._serializeAccounts() });
  }

  private _serializeAccounts() {
    return this.accountManager.getAccounts().map((account) => ({
      id: account.id,
      alias: account.alias,
      status: account.status,
      queriestoday: account.queriestoday,
      queriesTotalLifetime: account.queriesTotalLifetime,
      addedAt: account.addedAt,
      lastUsedAt: account.lastUsedAt,
      plan: account.capabilities?.plan || 'unknown',
      email: account.capabilities?.email,
      quotas: {
        quickSearch: formatQuotaSummary(account.quotas?.freeQueries),
        proSearch: formatQuotaSummary(account.quotas?.modes?.pro_search),
        research: formatQuotaSummary(account.quotas?.modes?.research),
        agenticResearch: formatQuotaSummary(account.quotas?.modes?.agentic_research),
        labs: formatQuotaSummary(account.quotas?.modes?.labs),
        computer: formatQuotaSummary(getQuotaItem(account, 'computer')),
      },
    }));
  }

  private _toWebviewModel(model: ModelInfo) {
    return {
      id: model.id,
      label: model.label,
      category: model.category,
      description: model.description,
      supportsThinking: model.supportsThinking,
      selectable: model.selectable !== false,
      requiredPlan: model.requiredPlan,
      isNew: model.isNew === true,
    };
  }

  private _toWebviewTaskMode(taskMode: TaskModeInfo) {
    return {
      id: taskMode.id,
      label: taskMode.label,
      category: taskMode.category,
      description: taskMode.description,
      supportsThinking: taskMode.supportsThinking,
      selectable: taskMode.selectable !== false,
      requiredPlan: taskMode.requiredPlan,
    };
  }

  private async _getAvailableModels(): Promise<ModelInfo[]> {
    const accounts = this.accountManager.getAccounts().filter((account) =>
      account.status !== 'disabled' && account.status !== 'expired'
    );

    if (accounts.length === 0) {
      return this.modelFetcher.getFallbackModels();
    }

    const availableModels = new Map<string, ModelInfo>();
    const modelLists = await Promise.all(accounts.map((account) => this.modelFetcher.getModels(account)));
    for (const models of modelLists) {
      for (const model of models) {
        if (!availableModels.has(model.id)) {
          availableModels.set(model.id, model);
        }
      }
    }

    return [...availableModels.values()].sort(compareModels);
  }

  private _getAvailableTaskModes(): TaskModeInfo[] {
    const accounts = this.accountManager.getAccounts().filter((account) =>
      account.status !== 'disabled' && account.status !== 'expired'
    );

    if (accounts.length === 0) {
      return this.taskModeFetcher.getFallbackModes();
    }

    const modes = new Map<string, TaskModeInfo>();
    for (const account of accounts) {
      for (const taskMode of this.taskModeFetcher.getModes(account)) {
        const existing = modes.get(taskMode.id);
        if (!existing || taskMode.selectable) {
          modes.set(taskMode.id, taskMode);
        }
      }
    }

    for (const fallbackMode of this.taskModeFetcher.getFallbackModes()) {
      if (!modes.has(fallbackMode.id)) {
        modes.set(fallbackMode.id, fallbackMode);
      }
    }

    return [...modes.values()].sort(compareTaskModes);
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'styles.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${stylesUri}">
  <title>PerplexiCode</title>
</head>
<body>
  <div class="ambient-shell">
    <div id="app" class="app-shell">
    <header class="chat-header">
      <div class="chat-header-title">PERPLEXICODE: CHAT</div>
      <div class="chat-toolbar">
        <div class="chat-brand">PerplexiCode</div>
        <div class="toolbar-picker-shell">
          <button id="model-picker-btn" class="toolbar-model-button" type="button" title="Select model" aria-haspopup="dialog" aria-expanded="false">
            <span id="model-picker-label">Best</span>
            <span class="toolbar-model-caret"></span>
          </button>
          <div id="model-picker-menu" class="model-picker-menu hidden">
            <div class="model-picker-card">
              <div class="model-picker-header">
                <div id="model-picker-title" class="model-picker-title">Best</div>
                <div id="model-picker-subtitle" class="model-picker-subtitle">Selects your best available models</div>
              </div>
              <div id="model-picker-list" class="model-picker-list"></div>
              <button id="thinking-toggle-btn" class="thinking-toggle-row" type="button">
                <span class="thinking-toggle-copy">
                  <span class="thinking-toggle-title">Thinking</span>
                  <span id="thinking-toggle-subtitle" class="thinking-toggle-subtitle">Use deeper reasoning when the selected model supports it.</span>
                </span>
                <span id="thinking-toggle-switch" class="thinking-toggle-switch">
                  <span class="thinking-toggle-thumb"></span>
                </span>
              </button>
            </div>
          </div>
        </div>
        <button id="new-chat-btn" class="toolbar-icon-btn" title="New conversation">+</button>
        <button id="accounts-btn" class="toolbar-icon-btn" title="Settings and account management">Settings</button>
      </div>
    </header>

    <main id="messages-container" class="messages-container">
      <section id="welcome-screen" class="welcome-screen">
        <div class="welcome-copy">
          <div class="welcome-kicker">Ready</div>
          <h2>Ask about your code, search, create files, or hand work off to Computer.</h2>
          <p>Choose a task mode first, then pick the AI model and the Normal or Thinking variant when that mode supports it.</p>
          <div class="welcome-tags">
            <span class="welcome-tag">Code</span>
            <span class="welcome-tag">Search</span>
            <span class="welcome-tag">Create</span>
            <span class="welcome-tag">Computer</span>
            <span class="welcome-tag">Workspace</span>
            <span class="welcome-tag">Apply edits</span>
          </div>
        </div>
      </section>
      <div id="messages-list" class="messages-list"></div>
    </main>

    <footer class="composer-panel composer-panel-compact">
      <div class="composer-shell">
        <div class="composer-frame">
          <textarea id="message-input" class="message-input" placeholder="Ask PerplexiCode anything, @ to add files, / for commands" rows="1"></textarea>
          <button id="send-btn" class="send-btn" title="Send">></button>
        </div>
        <div class="composer-footer-row">
          <span id="account-indicator" class="composer-account-meta">0/0 accounts active</span>
          <button id="manage-accounts-btn" class="footer-link-btn" title="Open account management">Manage accounts</button>
          <span class="composer-powered">Powered by Perplexity</span>
        </div>
      </div>
    </footer>
    </div>
    <div id="panel-overlay" class="panel-overlay">
      <aside class="accounts-panel">
        <div class="panel-header">
          <div class="panel-head-copy">
            <div class="panel-kicker">Control center</div>
            <div class="panel-title">Settings and Accounts</div>
            <div class="panel-subtitle">Manage connected profiles, account quotas, and the controls that affect how PerplexiCode answers.</div>
          </div>
          <button id="panel-close" class="icon-btn" title="Close">Close</button>
        </div>
        <div class="panel-tabs">
          <button id="accounts-tab-btn" class="panel-tab active" data-panel-tab="accounts">Accounts</button>
          <button id="settings-tab-btn" class="panel-tab" data-panel-tab="settings">Settings</button>
        </div>
        <div id="accounts-view" class="panel-view active">
          <div id="accounts-list" class="panel-body"></div>
          <div class="panel-footer">
            <button id="add-account-btn" class="solid-btn">Add Account</button>
            <button id="refresh-btn" class="ghost-btn" title="Refresh accounts and quotas">Refresh</button>
            <button id="signout-all-btn" class="ghost-btn danger">Sign Out All</button>
          </div>
        </div>
        <div id="settings-view" class="panel-view">
          <div class="settings-grid">
            <div class="settings-card">
              <div class="settings-card-title">Task Mode</div>
              <label class="compact-select-shell settings-select-shell" for="mode-selector">
                <span class="compact-select-label">Task Mode</span>
                <select id="mode-selector" class="compact-select-input">
                </select>
              </label>
              <div class="composer-meta">Use the model picker in the header to switch between Normal and Thinking.</div>
              <div class="settings-toggle-row">
                <button id="workspace-toggle" class="tool-chip" title="Include the current file and project tree">Workspace</button>
                <button id="agent-toggle" class="tool-chip" title="Auto-apply structured file edits">Auto Apply</button>
              </div>
            </div>
            <section id="model-visualizer" class="settings-card settings-model-card" data-category="search-models">
              <div class="composer-inline-main">
                <div id="model-glyph" class="composer-status-glyph">S</div>
                <span id="task-mode-badge" class="composer-status-pill accent">Search</span>
                <div id="selection-status" class="composer-status-name">Best</div>
                <span id="model-category-badge" class="composer-status-pill accent">Search Models</span>
                <span id="quota-pill" class="composer-status-pill">Unknown</span>
              </div>
              <div class="composer-inline-meta">
                <span id="footer-meta" class="composer-meta">Workspace on | Variant Normal | Auto apply off</span>
              </div>
              <span id="model-visual-description" class="composer-inline-description">Select an AI model, then switch between the Normal and Thinking variants when the model supports it.</span>
            </section>
          </div>
        </div>
      </aside>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let index = 0; index < 32; index += 1) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function stricterPlan(left: string, right: string): 'free' | 'pro' | 'max' | 'enterprise' | 'unknown' {
  const order = ['unknown', 'free', 'pro', 'max', 'enterprise'];
  return order.indexOf(left) >= order.indexOf(right) ? left as 'free' | 'pro' | 'max' | 'enterprise' | 'unknown' : right as 'free' | 'pro' | 'max' | 'enterprise' | 'unknown';
}

