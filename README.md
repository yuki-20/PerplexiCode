# PerplexiCode

Perplexity AI-powered coding agent for Visual Studio Code.

## Features

- **No API Keys** - Uses your Perplexity account session directly
- **Multi-Account** - Add unlimited accounts with automatic rotation
- **Mode + Model Selector** - Switch between Search, Create files & apps, and Computer while keeping the AI model picker accurate
- **Thinking Variants** - Use a separate Normal or Thinking toggle when the selected model and mode support it
- **Real-Time Search** - Every response includes live web context with citations
- **File-Aware** - Automatically includes your current file and project structure
- **Auto-Failover** - Rate-limited accounts automatically fail over to the next usable session
- **Quota Snapshots** - Review quick, pro, research, Labs, and Computer availability per account
- **Agent Apply** - Detect structured file replies and write them into your workspace

## Requirements

- **VS Code** 1.85 or later
- **Node.js** 18 or later (only for building from source)

## Installation

### From VSIX (Recommended)

1. Download the latest `.vsix` file from [Releases](../../releases)
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`)
3. Run **Extensions: Install from VSIX…**
4. Select the downloaded `.vsix` file
5. Reload VS Code

### Build from Source

```bash
git clone https://github.com/yuki-20/PerplexiCode.git
cd PerplexiCode
npm install
npm run build
```

To package as a `.vsix`:

```bash
npx @vscode/vsce package
```

Then install the generated `.vsix` via the method above.

## Getting Started

1. Install the extension
2. Run **PerplexiCode: Add Account** from the Command Palette (`Ctrl+Shift+P`)
3. Choose a login method:
   - **Import from Browser** — Reads cookies directly from Chrome/Edge/Brave (browser must be closed)
   - **Login in Browser** — Opens a Puppeteer-driven browser window for you to sign in
   - **Manual Paste** — Copy-paste your full Cookie header from DevTools
4. Click the **PerplexiCode** icon in the Activity Bar
5. Start chatting!

> **Note:** No API key is required. The extension uses your existing Perplexity account session cookies, which are stored securely in VS Code's encrypted SecretStorage.

## Commands

| Command | Description |
|---------|-------------|
| `PerplexiCode: Add Account` | Connect a Perplexity account |
| `PerplexiCode: Manage Accounts` | View, refresh, or remove accounts |
| `PerplexiCode: Select Mode / Model` | Choose the current task mode and AI model |
| `PerplexiCode: Set Rotation Strategy` | Round Robin, Least Used, or Failover Only |
| `PerplexiCode: Ask About Selection` | Query AI about selected code (`Ctrl+Shift+I`) |
| `PerplexiCode: Ask About Current File` | Analyze the active file |
| `PerplexiCode: Refresh Model List` | Re-fetch available models from Perplexity |

## Keyboard Shortcuts

| Shortcut | Command | Condition |
|----------|---------|-----------|
| `Ctrl+Shift+I` (`Cmd+Shift+I` on Mac) | Ask About Selection | Text is selected in editor |

## How It Works

PerplexiCode communicates with Perplexity AI using your account session cookies — the same ones your browser uses when you visit [perplexity.ai](https://perplexity.ai). This means:

- ✅ No API key or paid API plan needed
- ✅ Access to all models available on your Perplexity subscription
- ✅ Real-time web search in every response
- ✅ Tokens are encrypted locally via VS Code's SecretStorage

## License

MIT
