import * as vscode from "vscode";
import { callOpenRouter, OpenRouterMessage } from "./openrouter";
import { InlineDiffView } from "./inlineDiff";
import { ChatGPTProvider } from "./chatgpt";

let diffView: InlineDiffView;
let chatgpt: ChatGPTProvider;

export function activate(context: vscode.ExtensionContext) {
  diffView = new InlineDiffView();
  chatgpt = new ChatGPTProvider(context.secrets);
  chatgpt.initialize();

  context.subscriptions.push({ dispose: () => diffView.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("inlineEdit.chatgptLogin", async () => {
      try {
        await chatgpt.login();
        vscode.window.showInformationMessage(
          "Logged in to ChatGPT successfully!"
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        vscode.window.showErrorMessage(`ChatGPT login failed: ${msg}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inlineEdit.chatgptLogout", async () => {
      await chatgpt.logout();
      vscode.window.showInformationMessage("Logged out from ChatGPT.");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inlineEdit.run", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("No active editor");
        return;
      }

      const config = vscode.workspace.getConfiguration("inlineEdit");
      const provider = config.get<string>("provider", "openrouter");

      if (provider === "openrouter") {
        const apiKey = config.get<string>("openRouterApiKey", "");
        if (!apiKey) {
          const action = await vscode.window.showErrorMessage(
            "OpenRouter API key is not set.",
            "Open Settings"
          );
          if (action === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              "inlineEdit.openRouterApiKey"
            );
          }
          return;
        }
      } else if (provider === "chatgpt" && !chatgpt.loggedIn) {
        const action = await vscode.window.showErrorMessage(
          "Not logged in to ChatGPT.",
          "Login"
        );
        if (action === "Login") {
          vscode.commands.executeCommand("inlineEdit.chatgptLogin");
        }
        return;
      }

      const model = config.get<string>("model", "anthropic/claude-sonnet-4");
      const selection = editor.selection;
      const selectedText = editor.document.getText(selection);

      if (!selectedText) {
        vscode.window.showWarningMessage(
          "Select some code first, then press Ctrl+I."
        );
        return;
      }

      const instruction = await vscode.window.showInputBox({
        prompt: "What should the AI do with the selected code?",
        placeHolder:
          "e.g. Add error handling, refactor to async/await, implement bar feature...",
      });

      if (!instruction) {
        return;
      }

      const document = editor.document;
      const fileName = document.fileName;
      const languageId = document.languageId;
      const fullFileText = document.getText();

      const messages = buildMessages(
        fullFileText,
        selectedText,
        instruction,
        fileName,
        languageId
      );

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Inline Edit",
          cancellable: true,
        },
        async (progress, token) => {
          const label =
            provider === "chatgpt" ? "ChatGPT" : "OpenRouter";
          progress.report({ message: `Calling ${label}...` });

          const abortController = new AbortController();
          token.onCancellationRequested(() => abortController.abort());

          try {
            let result: string;

            if (provider === "chatgpt") {
              result = await chatgpt.call(messages, abortController.signal);
            } else {
              const apiKey = config.get<string>("openRouterApiKey", "")!;
              result = await callOpenRouter(
                apiKey,
                model,
                messages,
                abortController.signal
              );
            }

            const code = extractCode(result);
            await diffView.show(document, selection, code);
          } catch (err: unknown) {
            if (err instanceof Error && err.message === "Request aborted") {
              return;
            }
            const message =
              err instanceof Error ? err.message : "Unknown error";
            vscode.window.showErrorMessage(`Inline Edit failed: ${message}`);
          }
        }
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inlineEdit.accept", () => diffView.accept())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("inlineEdit.reject", () => diffView.reject())
  );
}

function buildMessages(
  fullFile: string,
  selectedText: string,
  instruction: string,
  fileName: string,
  languageId: string
): OpenRouterMessage[] {
  return [
    {
      role: "system",
      content: `You are a code editing assistant integrated into VS Code. The user has selected a portion of code and wants you to modify it.

Rules:
- Return ONLY the replacement code that should replace the selected text.
- Do NOT include any explanation, comments about changes, or markdown formatting.
- Do NOT wrap the code in code fences (\`\`\`).
- Preserve the indentation style of the original code.
- Only make changes relevant to the user's instruction.`,
    },
    {
      role: "user",
      content: `File: ${fileName} (${languageId})

Full file for context:
\`\`\`${languageId}
${fullFile}
\`\`\`

Selected code to modify:
\`\`\`${languageId}
${selectedText}
\`\`\`

Instruction: ${instruction}

Return ONLY the replacement code, no markdown fences, no explanation.`,
    },
  ];
}

/**
 * Extracts code from the response, stripping markdown fences if the model
 * includes them despite being told not to.
 */
function extractCode(response: string): string {
  const trimmed = response.trim();
  const fencePattern = /^```[\w]*\n?([\s\S]*?)\n?```$/;
  const match = trimmed.match(fencePattern);
  if (match) {
    return match[1];
  }
  return trimmed;
}

export function deactivate() {}
