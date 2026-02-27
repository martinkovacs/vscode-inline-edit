# Inline Edit

A VS Code extension for inline AI code editing. Select code, press `Ctrl+I`, describe the change — the diff appears directly in your file with red/green highlights. Accept with `Enter`, reject with `Escape`.

Supports [OpenRouter](https://openrouter.ai/), the [Anthropic API](https://console.anthropic.com/) (or your Claude subscription via OAuth), and [ChatGPT Plus](https://chatgpt.com/) via OAuth.

## Installation

### From source

```bash
git clone https://github.com/martinkovacs/vscode-inline-edit
cd vscode-inline-edit
npm install
npm run compile
```

Then in VS Code: open the Command Palette → **Developer: Install Extension from Location** and select the folder. Or press `F5` inside VS Code to launch an Extension Development Host.

### Prerequisites

- VS Code 1.85 or later
- Node.js 20 or later (for building from source)

## Usage

1. Select some code in the editor
2. Press `Ctrl+I` (`Cmd+I` on macOS)
3. Type your instruction (e.g. *"add error handling"*, *"convert to async/await"*)
4. Review the inline diff — changed lines are highlighted red (removed) and green (added)
5. Press `Enter` to accept or `Escape` to reject

The AI receives the full file for context and rewrites only the selected region.

## Setup

### OpenRouter (default)

1. Get an API key from [openrouter.ai](https://openrouter.ai/)
2. Open Settings and set `inlineEdit.openRouterApiKey`
3. Optionally change `inlineEdit.model` to any [OpenRouter model ID](https://openrouter.ai/models)

### Anthropic (direct API)

1. Get an API key from [console.anthropic.com](https://console.anthropic.com/)
2. Set `inlineEdit.provider` to `anthropic`
3. Set `inlineEdit.anthropicApiKey`
4. Set `inlineEdit.model` to a Claude model ID (e.g. `claude-sonnet-4-20250514`)

### Anthropic (OAuth — Claude Pro/Max subscription)

1. Set `inlineEdit.provider` to `anthropic`
2. Open the Command Palette → **Inline Edit: Login with Claude (Anthropic OAuth)**
3. Log in via the browser, then paste the authorization code shown on the redirect page back into VS Code

> **Note:** Anthropic currently restricts OAuth tokens to first-party apps. If you see *"credential only authorized for Claude Code"*, use an API key instead.

### ChatGPT (Plus/Pro subscription)

1. Set `inlineEdit.provider` to `chatgpt`
2. Open the Command Palette → **Inline Edit: Login with ChatGPT**
3. Log in via the browser — the extension receives the token automatically

ChatGPT always uses `gpt-5` regardless of the `inlineEdit.model` setting.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `inlineEdit.provider` | `openrouter` | Provider to use: `openrouter`, `anthropic`, or `chatgpt` |
| `inlineEdit.openRouterApiKey` | `""` | OpenRouter API key (used when provider is `openrouter`) |
| `inlineEdit.anthropicApiKey` | `""` | Anthropic API key (used when provider is `anthropic`; takes priority over OAuth) |
| `inlineEdit.model` | `anthropic/claude-sonnet-4` | Model ID — OpenRouter format for OpenRouter, Claude model ID for Anthropic. Ignored for ChatGPT. |

## Commands

| Command | Description |
|---|---|
| **Inline Edit: Edit Selection with AI** | Run the inline edit (`Ctrl+I` / `Cmd+I`) |
| **Inline Edit: Accept Changes** | Accept the diff (`Enter`) |
| **Inline Edit: Reject Changes** | Reject the diff (`Escape`) |
| **Inline Edit: Login with Claude (Anthropic OAuth)** | Authenticate with your Claude subscription |
| **Inline Edit: Logout from Claude (Anthropic)** | Clear stored Anthropic OAuth tokens |
| **Inline Edit: Login with ChatGPT** | Authenticate with your ChatGPT Plus subscription |
| **Inline Edit: Logout from ChatGPT** | Clear stored ChatGPT tokens |
