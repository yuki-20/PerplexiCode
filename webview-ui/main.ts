declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

interface ModelView {
  id: string;
  label: string;
  category: string;
  description: string;
  supportsThinking: boolean;
  selectable: boolean;
  requiredPlan: string;
  isNew?: boolean;
}

interface TaskModeView {
  id: string;
  label: string;
  category: string;
  description: string;
  supportsThinking: boolean;
  selectable: boolean;
  requiredPlan: string;
}

interface AccountView {
  id: string;
  alias: string;
  status: string;
  plan: string;
  email?: string;
  queriestoday: number;
  queriesTotalLifetime: number;
  addedAt: string;
  lastUsedAt?: string;
  quotas: Record<string, string>;
}

interface AppState {
  hasAccounts: boolean;
  currentTaskMode: string;
  taskModeLabel: string;
  taskModes: TaskModeView[];
  currentModel: string;
  modelLabel: string;
  models: ModelView[];
  isStreaming: boolean;
  accountCount: number;
  activeAccountCount: number;
  availableAccountCount: number;
  thinkingEnabled: boolean;
  thinkingAvailable: boolean;
  agentModeEnabled: boolean;
  workspaceModeEnabled: boolean;
  selectedQuota: string;
  accounts: AccountView[];
}

let state: AppState = {
  hasAccounts: false,
  currentTaskMode: 'search',
  taskModeLabel: 'Search',
  taskModes: [],
  currentModel: 'turbo',
  modelLabel: 'Best',
  models: [],
  isStreaming: false,
  accountCount: 0,
  activeAccountCount: 0,
  availableAccountCount: 0,
  thinkingEnabled: false,
  thinkingAvailable: false,
  agentModeEnabled: false,
  workspaceModeEnabled: true,
  selectedQuota: 'Unknown',
  accounts: [],
};

let currentStreamContent = '';
let currentStreamCitations: string[] = [];
let currentStreamAccount = '';
let currentStreamTaskMode = '';
let currentStreamModel = '';

const messagesContainer = document.getElementById('messages-container') as HTMLElement;
const messagesList = document.getElementById('messages-list') as HTMLElement;
const welcomeScreen = document.getElementById('welcome-screen') as HTMLElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const modeSelector = document.getElementById('mode-selector') as HTMLSelectElement;
const modelPickerButton = document.getElementById('model-picker-btn') as HTMLButtonElement;
const modelPickerLabel = document.getElementById('model-picker-label') as HTMLElement;
const modelPickerMenu = document.getElementById('model-picker-menu') as HTMLElement;
const modelPickerTitle = document.getElementById('model-picker-title') as HTMLElement;
const modelPickerSubtitle = document.getElementById('model-picker-subtitle') as HTMLElement;
const modelPickerList = document.getElementById('model-picker-list') as HTMLElement;
const thinkingToggleBtn = document.getElementById('thinking-toggle-btn') as HTMLButtonElement;
const thinkingToggleSubtitle = document.getElementById('thinking-toggle-subtitle') as HTMLElement;
const thinkingToggleSwitch = document.getElementById('thinking-toggle-switch') as HTMLElement;
const agentToggle = document.getElementById('agent-toggle') as HTMLButtonElement;
const workspaceToggle = document.getElementById('workspace-toggle') as HTMLButtonElement;
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement;
const newChatBtn = document.getElementById('new-chat-btn') as HTMLButtonElement;
const accountsBtn = document.getElementById('accounts-btn') as HTMLButtonElement;
const manageAccountsBtn = document.getElementById('manage-accounts-btn') as HTMLButtonElement;
const modelVisualizer = document.getElementById('model-visualizer') as HTMLElement;
const modelGlyph = document.getElementById('model-glyph') as HTMLElement;
const taskModeBadge = document.getElementById('task-mode-badge') as HTMLElement;
const modelCategoryBadge = document.getElementById('model-category-badge') as HTMLElement;
const modelVisualDescription = document.getElementById('model-visual-description') as HTMLElement;
const selectionStatus = document.getElementById('selection-status') as HTMLElement;
const quotaPill = document.getElementById('quota-pill') as HTMLElement;
const accountIndicator = document.getElementById('account-indicator') as HTMLElement;
const footerMeta = document.getElementById('footer-meta') as HTMLElement;
const panelOverlay = document.getElementById('panel-overlay') as HTMLElement;
const panelClose = document.getElementById('panel-close') as HTMLButtonElement;
const accountsList = document.getElementById('accounts-list') as HTMLElement;
const addAccountBtn = document.getElementById('add-account-btn') as HTMLButtonElement;
const signoutAllBtn = document.getElementById('signout-all-btn') as HTMLButtonElement;
const panelTabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-panel-tab]'));
const accountsView = document.getElementById('accounts-view') as HTMLElement;
const settingsView = document.getElementById('settings-view') as HTMLElement;
let isModelPickerOpen = false;

init();

function init(): void {
  setModelPickerOpen(false);
  messageInput.addEventListener('input', resizeInput);
  messageInput.addEventListener('keydown', handleInputKeydown);
  sendBtn.addEventListener('click', handleSendClick);
  modeSelector.addEventListener('change', handleTaskModeChange);
  modelPickerButton.addEventListener('click', handleModelPickerButtonClick);
  modelPickerMenu.addEventListener('click', (event) => event.stopPropagation());
  thinkingToggleBtn.addEventListener('click', handleThinkingToggle);
  agentToggle.addEventListener('click', toggleAgentMode);
  workspaceToggle.addEventListener('click', toggleWorkspaceMode);
  refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refreshAccountData' }));
  newChatBtn.addEventListener('click', handleNewChat);
  accountsBtn.addEventListener('click', () => openAccountsPanel('settings'));
  manageAccountsBtn.addEventListener('click', () => openAccountsPanel('accounts'));
  panelClose.addEventListener('click', closeAccountsPanel);
  panelTabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.dataset.panelTab === 'settings' ? 'settings' : 'accounts';
      setPanelTab(tab);
    });
  });
  panelOverlay.addEventListener('click', (event) => {
    if (event.target === panelOverlay) {
      closeAccountsPanel();
    }
  });
  window.addEventListener('click', handleWindowClick);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isModelPickerOpen) {
      setModelPickerOpen(false);
      return;
    }
    if (event.key === 'Escape' && panelOverlay.classList.contains('open')) {
      closeAccountsPanel();
    }
  });
  addAccountBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'addAccount' });
    closeAccountsPanel();
  });
  signoutAllBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'signOutAll' });
  });

  window.addEventListener('message', handleExtensionMessage);
  vscode.postMessage({ type: 'ready' });
}

function handleExtensionMessage(event: MessageEvent): void {
  const message = event.data;
  switch (message.type) {
    case 'initialState':
      state.hasAccounts = message.hasAccounts;
      state.currentTaskMode = message.taskMode || 'search';
      state.taskModeLabel = message.taskModeLabel || 'Search';
      state.taskModes = message.taskModes || [];
      state.currentModel = message.model;
      state.models = message.models;
      state.accountCount = message.accountCount;
      state.activeAccountCount = message.activeAccountCount;
      state.availableAccountCount = message.activeAccountCount;
      state.agentModeEnabled = message.agentModeEnabled;
      state.thinkingEnabled = message.thinkingEnabled;
      state.thinkingAvailable = message.thinkingAvailable;
      state.workspaceModeEnabled = message.workspaceModeEnabled ?? true;
      state.accounts = message.accounts || [];
      populateTaskModeSelector();
      populateModelSelector();
      renderAccountsPanel(state.accounts);
      updateSelectionUi();
      break;
    case 'selectionState':
      state.currentTaskMode = message.taskMode || state.currentTaskMode;
      state.taskModeLabel = message.taskModeLabel || state.taskModeLabel;
      state.currentModel = message.model;
      state.modelLabel = message.modelLabel;
      state.thinkingEnabled = message.thinkingEnabled;
      state.thinkingAvailable = message.thinkingAvailable;
      state.agentModeEnabled = message.agentModeEnabled;
      state.workspaceModeEnabled = message.workspaceModeEnabled ?? state.workspaceModeEnabled;
      state.availableAccountCount = message.availableAccountCount;
      state.selectedQuota = message.selectedQuota;
      updateSelectionUi();
      break;
    case 'modelsUpdated':
      state.taskModes = message.taskModes || state.taskModes;
      populateTaskModeSelector();
      state.models = message.models;
      populateModelSelector();
      updateSelectionUi();
      break;
    case 'accountsList':
      state.accounts = message.accounts || [];
      state.accountCount = state.accounts.length;
      state.activeAccountCount = state.accounts.filter((account) => account.status === 'active' || account.status === 'rate_limited').length;
      renderAccountsPanel(state.accounts);
      updateSelectionUi();
      break;
    case 'userMessage':
      hideWelcome();
      appendUserMessage(message.text);
      break;
    case 'streamStart':
      state.isStreaming = true;
      currentStreamContent = '';
      currentStreamCitations = [];
      currentStreamAccount = message.accountAlias || '';
      currentStreamTaskMode = message.taskModeLabel || state.taskModeLabel;
      currentStreamModel = message.modelLabel || state.modelLabel;
      appendAssistantStreamingMessage(currentStreamTaskMode, currentStreamModel, currentStreamAccount);
      updateSendButton();
      break;
    case 'streamChunk':
      currentStreamContent += message.content;
      updateStreamingMessage();
      break;
    case 'streamMeta':
      currentStreamTaskMode = message.taskModeLabel || currentStreamTaskMode;
      currentStreamModel = message.modelLabel || currentStreamModel;
      currentStreamAccount = message.accountAlias || currentStreamAccount;
      updateStreamingHeader();
      break;
    case 'streamReset':
      currentStreamContent = '';
      currentStreamCitations = [];
      updateStreamingMessage();
      break;
    case 'citations':
      currentStreamCitations = message.citations || [];
      break;
    case 'streamEnd':
      state.isStreaming = false;
      finalizeStreamingMessage(
        message.finalText || currentStreamContent,
        message.taskModeLabel || currentStreamTaskMode || state.taskModeLabel,
        message.modelLabel || currentStreamModel || state.modelLabel,
        message.accountAlias || currentStreamAccount,
        currentStreamCitations,
        message.fileEdits || [],
        message.appliedSummary
      );
      currentStreamContent = '';
      currentStreamCitations = [];
      currentStreamTaskMode = '';
      updateSendButton();
      break;
    case 'reviewOpened': {
      const statusList = document.querySelector('.review-status-list:last-of-type');
      if (statusList) {
        const item = document.createElement('div');
        item.className = 'review-status-item pending';
        item.dataset.editId = message.editId;
        item.innerHTML = `
          <span class="review-file-name">${escapeHtml(message.filePath)}</span>
          <span class="review-status-label">Reviewing...</span>
          <div class="review-item-actions">
            <button class="mini-btn accept-btn" data-edit-id="${escapeAttr(message.editId)}">Accept</button>
            <button class="mini-btn danger reject-btn" data-edit-id="${escapeAttr(message.editId)}">Reject</button>
          </div>
        `;
        item.querySelector('.accept-btn')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'acceptEdit', editId: message.editId });
        });
        item.querySelector('.reject-btn')?.addEventListener('click', () => {
          vscode.postMessage({ type: 'rejectEdit', editId: message.editId });
        });
        statusList.appendChild(item);
      }
      break;
    }
    case 'reviewResult': {
      const reviewItem = document.querySelector(`.review-status-item[data-edit-id="${message.editId}"]`);
      if (reviewItem) {
        reviewItem.classList.remove('pending');
        reviewItem.classList.add(message.accepted ? 'accepted' : 'rejected');
        const label = reviewItem.querySelector('.review-status-label');
        if (label) {
          label.textContent = message.accepted ? '✓ Applied' : '✗ Reverted';
        }
        const actions = reviewItem.querySelector('.review-item-actions');
        if (actions) {
          actions.remove();
        }
      }
      break;
    }
    case 'error':
      state.isStreaming = false;
      appendNotice('error', message.message);
      removeStreamingMessage();
      updateSendButton();
      break;
    case 'info':
      appendNotice('info', message.message);
      break;
  }
}

function resizeInput(): void {
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 180)}px`;
}

function handleInputKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSendClick();
  }
}

function handleSendClick(): void {
  if (state.isStreaming) {
    vscode.postMessage({ type: 'stopStreaming' });
    return;
  }

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  setModelPickerOpen(false);
  vscode.postMessage({
    type: 'sendMessage',
    text,
    contextOptions: {
      includeCurrentFile: state.workspaceModeEnabled,
      includeProjectTree: state.workspaceModeEnabled,
    },
  });
  messageInput.value = '';
  resizeInput();
}

function handleTaskModeChange(): void {
  state.currentTaskMode = modeSelector.value;
  const selectedTaskMode = state.taskModes.find((taskMode) => taskMode.id === state.currentTaskMode);
  state.taskModeLabel = selectedTaskMode?.label || 'Search';
  if (selectedTaskMode?.supportsThinking === false) {
    state.thinkingEnabled = false;
  }
  updateSelectionUi();
  vscode.postMessage({ type: 'changeTaskMode', taskMode: state.currentTaskMode });
}

function handleModelPickerButtonClick(event: MouseEvent): void {
  event.stopPropagation();
  setModelPickerOpen(!isModelPickerOpen);
}

function handleModelChange(modelId: string): void {
  if (!modelId || modelId === state.currentModel) {
    setModelPickerOpen(false);
    return;
  }

  state.currentModel = modelId;
  state.thinkingEnabled = false;
  updateSelectionUi();
  setModelPickerOpen(false);
  vscode.postMessage({ type: 'changeModel', model: state.currentModel });
}

function handleThinkingToggle(): void {
  const thinkingState = getThinkingControlState();
  if (!thinkingState.available) {
    return;
  }

  state.thinkingEnabled = !state.thinkingEnabled;
  updateSelectionUi();
  vscode.postMessage({ type: 'toggleThinking', enabled: state.thinkingEnabled });
}

function handleWindowClick(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (!target || !isModelPickerOpen) {
    return;
  }

  if (modelPickerButton.contains(target) || modelPickerMenu.contains(target)) {
    return;
  }

  setModelPickerOpen(false);
}

function toggleAgentMode(): void {
  state.agentModeEnabled = !state.agentModeEnabled;
  updateSelectionUi();
  vscode.postMessage({ type: 'toggleAgentMode', enabled: state.agentModeEnabled });
}

function toggleWorkspaceMode(): void {
  state.workspaceModeEnabled = !state.workspaceModeEnabled;
  updateSelectionUi();
  vscode.postMessage({ type: 'toggleWorkspaceMode', enabled: state.workspaceModeEnabled });
}

function handleNewChat(): void {
  setModelPickerOpen(false);
  messagesList.innerHTML = '';
  welcomeScreen.classList.remove('hidden');
  currentStreamContent = '';
  currentStreamCitations = [];
  vscode.postMessage({ type: 'newConversation' });
}

function populateTaskModeSelector(): void {
  modeSelector.innerHTML = '';

  for (const taskMode of state.taskModes) {
    const option = document.createElement('option');
    option.value = taskMode.id;
    option.textContent = taskMode.selectable ? taskMode.label : `${taskMode.label} (${taskMode.requiredPlan.toUpperCase()})`;
    option.selected = taskMode.id === state.currentTaskMode;
    option.disabled = !taskMode.selectable;
    option.title = taskMode.description;
    modeSelector.appendChild(option);
  }
}

function populateModelSelector(): void {
  modelPickerList.innerHTML = '';

  if (state.models.length === 0) {
    modelPickerList.innerHTML = '<div class="model-picker-empty">No models available yet.</div>';
    return;
  }

  let currentGroup = '';
  let groupElement: HTMLDivElement | null = null;

  for (const model of state.models) {
    if (model.category !== currentGroup) {
      currentGroup = model.category;
      groupElement = document.createElement('div');
      groupElement.className = 'model-picker-section';
      groupElement.innerHTML = `<div class="model-picker-section-title">${escapeHtml(currentGroup)}</div>`;
      modelPickerList.appendChild(groupElement);
    }

    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'model-picker-option';
    option.dataset.modelId = model.id;
    option.disabled = !model.selectable;
    option.title = model.description;
    option.classList.toggle('active', model.id === state.currentModel);
    option.classList.toggle('locked', !model.selectable);

    const planBadge = !model.selectable || model.requiredPlan === 'max'
      ? `<span class="model-picker-option-pill">${escapeHtml(model.requiredPlan.toUpperCase())}</span>`
      : '';
    const lockGlyph = !model.selectable ? '<span class="model-picker-option-lock" aria-hidden="true">Lock</span>' : '';
    const thinkingBadge = model.supportsThinking && currentTaskModeSupportsThinking()
      ? '<span class="model-picker-option-pill subtle">Thinking</span>'
      : '';
    const newBadge = model.isNew ? '<span class="model-picker-option-pill new">New</span>' : '';

    option.innerHTML = `
      <span class="model-picker-option-copy">
        <span class="model-picker-option-title">${escapeHtml(model.label)}</span>
        <span class="model-picker-option-description">${escapeHtml(model.description)}</span>
      </span>
      <span class="model-picker-option-meta">
        ${newBadge}
        ${thinkingBadge}
        ${planBadge}
        ${lockGlyph}
      </span>
    `;
    option.addEventListener('click', () => handleModelChange(model.id));
    groupElement?.appendChild(option);
  }
}

function updateSelectionUi(): void {
  const selectedTaskMode = state.taskModes.find((taskMode) => taskMode.id === state.currentTaskMode);
  const selected = state.models.find((model) => model.id === state.currentModel);
  const thinkingState = getThinkingControlState(selectedTaskMode, selected);
  if (!thinkingState.supported) {
    state.thinkingEnabled = false;
  }
  const selectionLabel = state.thinkingEnabled && thinkingState.supported && selected?.label
    ? `${selected.label} Thinking`
    : selected?.label || state.modelLabel || 'Best';

  taskModeBadge.textContent = selectedTaskMode?.label || state.taskModeLabel || 'Search';
  selectionStatus.textContent = selectionLabel;
  quotaPill.textContent = state.selectedQuota;
  accountIndicator.textContent = `${state.availableAccountCount}/${state.accountCount} accounts active`;
  footerMeta.textContent = `${state.workspaceModeEnabled ? 'Workspace on' : 'Workspace off'} | ${selectedTaskMode?.label || state.taskModeLabel || 'Search'} | ${!thinkingState.supported ? 'Thinking unavailable' : state.thinkingEnabled ? 'Variant Thinking' : 'Variant Normal'} | ${state.agentModeEnabled ? 'Auto apply on' : 'Auto apply off'}`;

  populateModelSelector();
  modelPickerLabel.textContent = selected?.label || state.modelLabel || 'Best';
  modelPickerTitle.textContent = selected?.label || state.modelLabel || 'Best';
  modelPickerSubtitle.textContent = buildModelPickerSubtitle(selectedTaskMode, selected);
  thinkingToggleBtn.disabled = !thinkingState.available;
  thinkingToggleBtn.classList.toggle('active', state.thinkingEnabled);
  thinkingToggleBtn.classList.toggle('supported', thinkingState.supported);
  thinkingToggleSubtitle.textContent = thinkingState.subtitle;
  thinkingToggleSwitch.classList.toggle('on', state.thinkingEnabled && thinkingState.available);
  agentToggle.classList.toggle('active', state.agentModeEnabled);
  agentToggle.textContent = state.agentModeEnabled ? 'Auto Apply On' : 'Auto Apply';
  workspaceToggle.classList.toggle('active', state.workspaceModeEnabled);
  workspaceToggle.textContent = state.workspaceModeEnabled ? 'Workspace On' : 'Workspace Off';

  if (selectedTaskMode) {
    modeSelector.value = selectedTaskMode.id;
  }

  highlightActiveModelOption();
  updateModelVisualizer(selectedTaskMode, selected);
}

function setModelPickerOpen(open: boolean): void {
  isModelPickerOpen = open;
  modelPickerMenu.classList.toggle('hidden', !open);
  modelPickerButton.classList.toggle('open', open);
  modelPickerButton.setAttribute('aria-expanded', String(open));
}

function highlightActiveModelOption(): void {
  modelPickerList.querySelectorAll<HTMLButtonElement>('.model-picker-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.modelId === state.currentModel);
  });
}

function buildModelPickerSubtitle(selectedTaskMode?: TaskModeView, selected?: ModelView): string {
  const description = selected?.description || 'Selects your best available models.';
  if (!selectedTaskMode || selectedTaskMode.id === 'search') {
    return description;
  }

  return `${selectedTaskMode.label}: ${description}`;
}

function getThinkingControlState(selectedTaskMode?: TaskModeView, selected?: ModelView): {
  supported: boolean;
  available: boolean;
  subtitle: string;
} {
  const taskMode = selectedTaskMode || state.taskModes.find((entry) => entry.id === state.currentTaskMode);
  const model = selected || state.models.find((entry) => entry.id === state.currentModel);
  const taskModeSupportsThinking = taskMode?.supportsThinking !== false;
  const modelSupportsVariant = Boolean(model?.supportsThinking);
  const supported = taskModeSupportsThinking && modelSupportsVariant;

  if (!taskModeSupportsThinking) {
    return {
      supported: false,
      available: false,
      subtitle: `${taskMode?.label || 'This task mode'} uses a fixed Perplexity route, so Thinking is unavailable.`,
    };
  }

  if (!modelSupportsVariant) {
    return {
      supported: false,
      available: false,
      subtitle: `${model?.label || 'This model'} only exposes a Normal variant right now.`,
    };
  }

  if (!state.thinkingAvailable) {
    return {
      supported: true,
      available: false,
      subtitle: 'No active account can use the Thinking variant for this selection right now.',
    };
  }

  return {
    supported: true,
    available: true,
    subtitle: 'Use deeper reasoning on the Perplexity side for this model.',
  };
}

function updateModelVisualizer(selectedTaskMode?: TaskModeView, selected?: ModelView): void {
  const category = selectedTaskMode && selectedTaskMode.id !== 'search'
    ? selectedTaskMode.label
    : (selected?.category || 'Search Models');
  const categoryToken = selectedTaskMode && selectedTaskMode.id !== 'search'
    ? toCategoryToken(selectedTaskMode.id)
    : toCategoryToken(category);
  const description = selectedTaskMode?.id && selectedTaskMode.id !== 'search'
    ? selectedTaskMode.description
    : (selected?.description || getDefaultModelDescription(categoryToken));

  modelVisualizer.dataset.category = categoryToken;
  modelGlyph.textContent = getModelGlyph(categoryToken);
  modelCategoryBadge.textContent = category;
  modelVisualDescription.textContent = description;
}

function getDefaultModelDescription(categoryToken: string): string {
  switch (categoryToken) {
    case 'labs':
      return 'Use Perplexity Create files and apps when one of your connected accounts exposes Labs access.';
    case 'computer':
      return 'Use Perplexity Computer when one of your connected accounts exposes computer access and credits.';
    case 'max-models':
      return 'Use a Max-only model when one of your connected accounts exposes that access tier.';
    default:
      return 'Select an AI model, then switch between the Normal and Thinking variants when supported.';
  }
}

function toCategoryToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'search-models';
}

function getModelGlyph(categoryToken: string): string {
  switch (categoryToken) {
    case 'labs':
      return 'C';
    case 'computer':
      return 'P';
    case 'max-models':
      return 'M';
    default:
      return 'S';
  }
}

function updateSendButton(): void {
  sendBtn.textContent = state.isStreaming ? 'Stop' : '>';
  sendBtn.classList.toggle('stop', state.isStreaming);
}

function openAccountsPanel(tab: 'accounts' | 'settings' = 'accounts'): void {
  setModelPickerOpen(false);
  document.body.classList.add('panel-open');
  panelOverlay.classList.add('open');
  setPanelTab(tab);
  vscode.postMessage({ type: 'getAccounts' });
}

function closeAccountsPanel(): void {
  document.body.classList.remove('panel-open');
  panelOverlay.classList.remove('open');
}

function renderAccountsPanel(accounts: AccountView[]): void {
  if (accounts.length === 0) {
    accountsList.innerHTML = '<div class="empty-panel">No accounts added yet.</div>';
    return;
  }

  accountsList.innerHTML = accounts.map((account) => `
    <div class="account-card">
      <div class="account-card-head">
        <div>
          <div class="account-name">
            <span class="status-dot ${escapeAttr(account.status)}"></span>
            ${escapeHtml(account.alias)}
          </div>
          <div class="account-tags">
            <span class="plan-chip">${escapeHtml(account.plan.toUpperCase())}</span>
            ${account.email ? `<span class="account-email">${escapeHtml(account.email)}</span>` : ''}
          </div>
        </div>
        <div class="account-state">${escapeHtml(account.status)}</div>
      </div>
      <div class="account-summary">
        <span>Today ${escapeHtml(formatCount(account.queriestoday))}</span>
        <span>Lifetime ${escapeHtml(formatCount(account.queriesTotalLifetime))}</span>
      </div>
      <div class="quota-grid">
        <div><span>Quick</span><strong>${escapeHtml(account.quotas.quickSearch)}</strong></div>
        <div><span>Pro</span><strong>${escapeHtml(account.quotas.proSearch)}</strong></div>
        <div><span>Research</span><strong>${escapeHtml(account.quotas.research)}</strong></div>
        <div><span>Labs</span><strong>${escapeHtml(account.quotas.labs)}</strong></div>
        <div><span>Computer</span><strong>${escapeHtml(account.quotas.computer)}</strong></div>
      </div>
      <div class="account-actions">
        <button class="mini-btn" data-action="toggle" data-id="${escapeAttr(account.id)}">${account.status === 'disabled' ? 'Enable' : 'Disable'}</button>
        <button class="mini-btn danger" data-action="remove" data-id="${escapeAttr(account.id)}">Remove</button>
      </div>
    </div>
  `).join('');

  accountsList.querySelectorAll<HTMLButtonElement>('[data-action="toggle"]').forEach((button) => {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleAccount', accountId: button.dataset.id });
    });
  });
  accountsList.querySelectorAll<HTMLButtonElement>('[data-action="remove"]').forEach((button) => {
    button.addEventListener('click', () => {
      vscode.postMessage({ type: 'removeAccount', accountId: button.dataset.id });
    });
  });
}

function hideWelcome(): void {
  welcomeScreen.classList.add('hidden');
}

function setPanelTab(tab: 'accounts' | 'settings'): void {
  panelTabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.panelTab === tab);
  });
  accountsView.classList.toggle('active', tab === 'accounts');
  settingsView.classList.toggle('active', tab === 'settings');
}

function appendUserMessage(text: string): void {
  const element = document.createElement('article');
  element.className = 'message user';
  element.innerHTML = `
    <div class="message-shell">
      <div class="message-avatar user-avatar">You</div>
      <div class="message-body">
        <div class="message-head">
          <div class="message-role">You</div>
        </div>
        <div class="message-content"><p>${escapeHtml(text).replace(/\n/g, '<br>')}</p></div>
      </div>
    </div>
  `;
  messagesList.appendChild(element);
  scrollToBottom();
}

function appendAssistantStreamingMessage(taskModeLabel: string, modelLabel: string, accountAlias: string): void {
  hideWelcome();
  const element = document.createElement('article');
  element.className = 'message assistant';
  element.id = 'streaming-message';
  element.innerHTML = `
    <div class="message-shell">
      <div class="message-avatar assistant-avatar">AI</div>
      <div class="message-body">
        <div class="message-head">
          <div class="message-role">PerplexiCode</div>
          <div class="message-badges" id="streaming-badges">
            <span class="message-badge subtle">${escapeHtml(taskModeLabel)}</span>
            <span class="message-badge">${escapeHtml(modelLabel)}</span>
            ${accountAlias ? `<span class="message-badge subtle">${escapeHtml(accountAlias)}</span>` : ''}
          </div>
        </div>
        <div class="message-content" id="streaming-content">${renderMarkdown('')}</div>
      </div>
    </div>
  `;
  messagesList.appendChild(element);
  scrollToBottom();
}

function updateStreamingMessage(): void {
  const content = document.getElementById('streaming-content');
  if (!content) {
    return;
  }

  content.innerHTML = renderMarkdown(currentStreamContent) + streamingIndicatorHtml();
  scrollToBottom();
}

function updateStreamingHeader(): void {
  const badges = document.getElementById('streaming-badges');
  if (!badges) {
    return;
  }

  badges.innerHTML = `
    <span class="message-badge subtle">${escapeHtml(currentStreamTaskMode || state.taskModeLabel)}</span>
    <span class="message-badge">${escapeHtml(currentStreamModel || state.modelLabel)}</span>
    ${currentStreamAccount ? `<span class="message-badge subtle">${escapeHtml(currentStreamAccount)}</span>` : ''}
  `;
}

function finalizeStreamingMessage(
  finalText: string,
  taskModeLabel: string,
  modelLabel: string,
  accountAlias: string,
  citations: string[],
  fileEdits: any[],
  appliedSummary?: { message: string }
): void {
  const message = document.getElementById('streaming-message');
  const content = document.getElementById('streaming-content');
  if (!message || !content) {
    return;
  }

  if (!finalText) {
    message.remove();
    return;
  }

  content.innerHTML = renderMarkdown(finalText);
  addCodeActions(content);

  const badges = message.querySelector('.message-badges');
  if (badges) {
    badges.innerHTML = `
      <span class="message-badge subtle">${escapeHtml(taskModeLabel)}</span>
      <span class="message-badge">${escapeHtml(modelLabel)}</span>
      ${accountAlias ? `<span class="message-badge subtle">${escapeHtml(accountAlias)}</span>` : ''}
    `;
  }

  if (citations.length > 0) {
    content.appendChild(renderCitations(citations));
  }

  if (fileEdits.length > 0) {
    content.appendChild(renderApplyCard(fileEdits, appliedSummary));
  } else if (appliedSummary?.message) {
    const summary = document.createElement('div');
    summary.className = 'apply-summary';
    summary.textContent = appliedSummary.message;
    content.appendChild(summary);
  }

  message.removeAttribute('id');
  content.removeAttribute('id');
  scrollToBottom();
}

function renderApplyCard(fileEdits: any[], appliedSummary?: { message: string }): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'apply-card';
  const files = fileEdits.map((edit) => escapeHtml(edit.path)).join(', ');
  wrapper.innerHTML = `
    <div class="apply-card-head">
      <div>
        <div class="apply-title">Structured file output detected</div>
        <div class="apply-subtitle">${files}</div>
      </div>
      <div class="apply-btn-group">
        <button class="outline-btn small review-btn">Review Changes</button>
        <button class="solid-btn small">Apply to Files</button>
      </div>
    </div>
    ${appliedSummary?.message ? `<div class="apply-summary">${escapeHtml(appliedSummary.message)}</div>` : ''}
    <div class="review-status-list"></div>
  `;
  wrapper.querySelector('.review-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'reviewChanges', edits: fileEdits });
  });
  wrapper.querySelector('.solid-btn')?.addEventListener('click', () => {
    vscode.postMessage({ type: 'applyFiles', edits: fileEdits });
  });
  return wrapper;
}

function renderCitations(citations: string[]): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'citation-strip';
  wrapper.innerHTML = citations.map((citation, index) => `
    <a class="citation-chip" href="${escapeAttr(citation)}" title="${escapeAttr(citation)}">
      <span>${index + 1}</span>${escapeHtml(extractDomain(citation))}
    </a>
  `).join('');
  return wrapper;
}

function addCodeActions(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach((block) => {
    const code = block.querySelector('code');
    if (!code || block.querySelector('.code-toolbar')) {
      return;
    }

    const text = code.textContent || '';
    const language = Array.from(code.classList).find((entry) => entry.startsWith('language-'))?.replace('language-', '') || 'code';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    toolbar.innerHTML = `
      <span class="code-language">${escapeHtml(language)}</span>
      <div class="code-actions">
        <button class="code-btn" data-action="copy">Copy</button>
        <button class="code-btn" data-action="insert">Insert</button>
      </div>
    `;
    block.insertBefore(toolbar, block.firstChild);

    toolbar.querySelector<HTMLButtonElement>('[data-action="copy"]')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'copyCode', code: text });
    });
    toolbar.querySelector<HTMLButtonElement>('[data-action="insert"]')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'insertCode', code: text });
    });
  });
}

function appendNotice(kind: 'info' | 'error', message: string): void {
  const element = document.createElement('div');
  element.className = `notice ${kind}`;
  element.textContent = message;
  messagesList.appendChild(element);
  scrollToBottom();
}

function removeStreamingMessage(): void {
  document.getElementById('streaming-message')?.remove();
}

function renderMarkdown(markdown: string): string {
  const codeBlocks: string[] = [];
  const placeholders = markdown.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, info, code) => {
    const lang = escapeAttr((info || '').trim().split(/\s+/)[0] || 'code');
    const html = `<pre><code class="language-${lang}">${escapeHtml(code.trim())}</code></pre>`;
    const key = `@@CODEBLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(html);
    return key;
  });

  let html = escapeHtml(placeholders);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^\- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  html = html.split(/\n{2,}/).map((segment) => {
    if (/^<h\d|^<ul>|^@@CODEBLOCK_/.test(segment)) {
      return segment;
    }
    return `<p>${segment.replace(/\n/g, '<br>')}</p>`;
  }).join('');

  codeBlocks.forEach((block, index) => {
    html = html.replace(`@@CODEBLOCK_${index}@@`, block);
  });

  return html || '<p></p>';
}

function streamingIndicatorHtml(): string {
  return '<span class="streaming-indicator"><span></span><span></span><span></span></span>';
}

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString() : '0';
}

function currentTaskModeSupportsThinking(): boolean {
  return state.taskModes.find((taskMode) => taskMode.id === state.currentTaskMode)?.supportsThinking !== false;
}

function scrollToBottom(): void {
  requestAnimationFrame(() => {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}
