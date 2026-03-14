import * as vscode from 'vscode';
import { CapabilityFetcher } from './api/capabilityFetcher';
import { setRuntimeModelCatalog } from './api/modelCatalog';
import { ModelFetcher } from './api/modelFetcher';
import { RotationEngine } from './api/rotationEngine';
import { TaskModeFetcher } from './api/taskModeCatalog';
import { RotationStrategy } from './api/types';
import { ContextBuilder } from './context/contextBuilder';
import { FileReader } from './context/fileReader';
import { ChatViewProvider } from './providers/chatViewProvider';
import { LoginProvider } from './providers/loginProvider';
import { AccountManager } from './storage/accountManager';
import { StatusBarManager } from './ui/statusBar';

let statusBar: StatusBarManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const accountManager = new AccountManager(context.globalState, context.secrets);
  await accountManager.initialize();

  const rotationEngine = new RotationEngine();
  const capabilityFetcher = new CapabilityFetcher();
  const modelFetcher = new ModelFetcher();
  const taskModeFetcher = new TaskModeFetcher();
  const fileReader = new FileReader();
  const contextBuilder = new ContextBuilder(fileReader);
  const loginProvider = new LoginProvider();
  statusBar = new StatusBarManager();

  const getConfiguredDefaultModel = () => vscode.workspace
    .getConfiguration('perplexicode')
    .get<string>('defaultModel', 'turbo');

  const initializeModels = async (force = false) => {
    const accounts = accountManager.getAccounts();
    await capabilityFetcher.refreshAccounts(accounts, force);
    await accountManager.saveMetas();

    const activeAccount = rotationEngine.selectAccount(accounts) || accounts.find((account) => account.status === 'active');
    const models = activeAccount
      ? await modelFetcher.getModels(activeAccount)
      : modelFetcher.getFallbackModels();
    const taskModes = activeAccount
      ? taskModeFetcher.getModes(activeAccount)
      : taskModeFetcher.getFallbackModes();

    setRuntimeModelCatalog(models);
    statusBar.setTaskModes(taskModes);
    statusBar.setModels(models);
    statusBar.setModel(getConfiguredDefaultModel());
    statusBar.setAccountInfo(accounts.length, accountManager.getActiveCount());
  };

  await initializeModels();

  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    accountManager,
    rotationEngine,
    modelFetcher,
    taskModeFetcher,
    capabilityFetcher,
    fileReader,
    contextBuilder,
    statusBar
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      chatProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.addAccount', async () => {
      const tokens = await loginProvider.login();
      if (!tokens) {
        return;
      }

      const alias = await vscode.window.showInputBox({
        title: 'Account Alias',
        prompt: 'Give this account a name (for example Personal or Work)',
        value: `Account ${accountManager.getAccounts().length + 1}`,
      });

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'PerplexiCode: Adding account...',
        },
        async () => accountManager.addAccount(alias || 'Account', tokens.sessionToken, tokens.csrfToken, {
          fullCookies: tokens.fullCookies,
        })
      );

      if (!result.success || !result.account) {
        vscode.window.showErrorMessage(`PerplexiCode: ${result.error}`);
        return;
      }

      await capabilityFetcher.refreshAccount(result.account, true).catch(() => undefined);
      await accountManager.saveMetas();
      await initializeModels(true);
      await chatProvider.refreshModels(true);

      vscode.window.showInformationMessage(`PerplexiCode: Account "${result.account.alias}" added successfully.`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.manageAccounts', async () => {
      const accounts = accountManager.getAccounts();
      if (accounts.length === 0) {
        const action = await vscode.window.showInformationMessage('PerplexiCode: No accounts configured.', 'Add Account');
        if (action === 'Add Account') {
          void vscode.commands.executeCommand('perplexicode.addAccount');
        }
        return;
      }

      const items = accounts.map((account) => ({
        label: `[${formatAccountStatus(account.status)}] ${account.alias}`,
        description: `${account.capabilities?.plan || 'unknown'} - ${account.queriestoday} today - ${account.queriesTotalLifetime} total`,
        accountId: account.id,
      }));
      items.push({ label: '$(add) Add New Account', description: '', accountId: '__add__' });

      const selected = await vscode.window.showQuickPick(items, {
        title: 'PerplexiCode: Manage Accounts',
        placeHolder: 'Select an account to manage',
      });

      if (!selected) {
        return;
      }

      if (selected.accountId === '__add__') {
        void vscode.commands.executeCommand('perplexicode.addAccount');
        return;
      }

      const account = accounts.find((entry) => entry.id === selected.accountId);
      if (!account) {
        return;
      }

      const action = await vscode.window.showQuickPick([
        { label: '$(refresh) Refresh Session', action: 'refresh' },
        { label: account.status === 'disabled' ? '$(check) Enable' : '$(close) Disable', action: 'toggle' },
        { label: '$(trash) Remove', action: 'remove' },
      ], {
        title: `Manage: ${account.alias}`,
      });

      if (!action) {
        return;
      }

      if (action.action === 'refresh') {
        const tokens = await loginProvider.login();
        if (!tokens) {
          return;
        }

        const success = await accountManager.updateTokens(account.id, tokens.sessionToken, tokens.csrfToken, tokens.fullCookies);
        if (!success) {
          vscode.window.showErrorMessage('PerplexiCode: Could not update session tokens.');
          return;
        }

        await capabilityFetcher.refreshAccount(account, true).catch(() => undefined);
        await initializeModels(true);
        await chatProvider.refreshModels(true);
        vscode.window.showInformationMessage(`PerplexiCode: "${account.alias}" refreshed successfully.`);
        return;
      }

      if (action.action === 'toggle') {
        await accountManager.toggleAccount(account.id);
        await initializeModels(true);
        await chatProvider.refreshModels(true);
        return;
      }

      if (action.action === 'remove') {
        const confirm = await vscode.window.showWarningMessage(
          `Remove account "${account.alias}"?`,
          { modal: true },
          'Remove'
        );
        if (confirm === 'Remove') {
          await accountManager.removeAccount(account.id);
          await initializeModels(true);
          await chatProvider.refreshModels(true);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('perplexicode.defaultModel')) {
        return;
      }

      statusBar.setModel(getConfiguredDefaultModel());
      await chatProvider.refreshModels();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.selectModel', async () => {
      await statusBar.showModelPicker();
      await chatProvider.refreshModels();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.refreshModels', async () => {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'PerplexiCode: Refreshing models and quotas...',
        },
        async () => {
          await initializeModels(true);
          await chatProvider.refreshModels(true);
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.openChat', () => {
      void vscode.commands.executeCommand('perplexicode.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.askAboutSelection', async () => {
      await chatProvider.sendSelectionQuery();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.askAboutFile', async () => {
      const currentFile = fileReader.readCurrentFile();
      if (!currentFile) {
        vscode.window.showWarningMessage('PerplexiCode: No file is currently open.');
        return;
      }

      const query = `Analyze and explain this file (${currentFile.relativePath || currentFile.fileName}):\n\n\`\`\`${currentFile.language}\n${currentFile.content}\n\`\`\``;
      await chatProvider.sendSelectionQuery(query);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('perplexicode.setRotationStrategy', async () => {
      const strategies: { label: string; description: string; strategy: RotationStrategy }[] = [
        { label: '$(sync) Round Robin', description: 'Cycle through available accounts', strategy: 'round-robin' },
        { label: '$(graph-line) Least Used', description: 'Prefer the account with the fewest queries today', strategy: 'least-used' },
        { label: '$(shield) Failover Only', description: 'Stick to the primary account until it fails', strategy: 'failover-only' },
      ];

      const current = rotationEngine.getStrategy();
      const items = strategies.map((strategy) => ({
        ...strategy,
        label: strategy.strategy === current ? `$(check) ${strategy.label}` : `     ${strategy.label}`,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: 'PerplexiCode: Rotation Strategy',
        placeHolder: 'Select how queries are distributed across accounts',
      });

      if (selected) {
        rotationEngine.setStrategy(selected.strategy);
        vscode.window.showInformationMessage(`Rotation strategy: ${selected.strategy}`);
      }
    })
  );

  context.subscriptions.push(statusBar);

  const output = vscode.window.createOutputChannel('PerplexiCode');
  output.appendLine(`PerplexiCode v1.0.3 activated at ${new Date().toISOString()}`);
  output.appendLine(`Accounts: ${accountManager.getAccounts().length} configured`);
  context.subscriptions.push(output);
}

export function deactivate(): void {
  // No-op.
}

function formatAccountStatus(status: string): string {
  switch (status) {
    case 'active':
      return 'ACTIVE';
    case 'rate_limited':
      return 'RATE LIMITED';
    case 'expired':
      return 'EXPIRED';
    case 'disabled':
      return 'DISABLED';
    default:
      return 'ERROR';
  }
}
