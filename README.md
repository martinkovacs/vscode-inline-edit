# Inline Edit

A VS Code extension for inline code editing powered by LLMs via [OpenRouter](https://openrouter.ai/).

## Usage

1. Select some code in the editor
2. Press `Ctrl+I` (`Cmd+I` on macOS)
3. Type what you want the AI to do with the selected code
4. The selected code is replaced with the AI-generated result

The AI receives the full file for context and your selected text as the target to modify.

## Setup

1. Get an API key from [OpenRouter](https://openrouter.ai/)
2. Open VS Code Settings and search for `inlineEdit`
3. Set your API key in **Inline Edit: Open Router Api Key**
4. Optionally change the model in **Inline Edit: Model** (default: `anthropic/claude-sonnet-4`)

## Configuration

| Setting | Default | Description |
|---|---|---|
| `inlineEdit.openRouterApiKey` | `""` | Your OpenRouter API key |
| `inlineEdit.model` | `anthropic/claude-sonnet-4` | The model to use via OpenRouter |
