import * as vscode from "vscode";

export const SCHEME = "inline-edit";

/**
 * Provides virtual document content for the diff view.
 * Stores original and modified file contents keyed by URI path.
 */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  set(uri: vscode.Uri, content: string) {
    this.contents.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  clear() {
    this.contents.clear();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}

export interface PendingEdit {
  /** The real document URI */
  documentUri: vscode.Uri;
  /** The selection range to replace */
  range: vscode.Range;
  /** The new code to insert */
  newCode: string;
}

export class DiffView {
  private provider: DiffContentProvider;
  private pendingEdit: PendingEdit | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.provider = new DiffContentProvider();

    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(
        SCHEME,
        this.provider
      )
    );

    // Close diff view when the user switches away from it
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.pendingEdit && editor) {
          const scheme = editor.document.uri.scheme;
          if (scheme !== SCHEME) {
            this.reject();
          }
        }
      })
    );
  }

  async show(
    document: vscode.TextDocument,
    range: vscode.Range,
    newCode: string
  ): Promise<void> {
    const originalText = document.getText();
    const modifiedText =
      originalText.substring(0, document.offsetAt(range.start)) +
      newCode +
      originalText.substring(document.offsetAt(range.end));

    const baseName = document.uri.path.split("/").pop() ?? "file";

    const originalUri = vscode.Uri.parse(
      `${SCHEME}://original/${baseName}`
    );
    const modifiedUri = vscode.Uri.parse(
      `${SCHEME}://modified/${baseName}`
    );

    this.provider.set(originalUri, originalText);
    this.provider.set(modifiedUri, modifiedText);

    this.pendingEdit = {
      documentUri: document.uri,
      range,
      newCode,
    };

    await vscode.commands.executeCommand("setContext", "inlineEdit.diffVisible", true);

    await vscode.commands.executeCommand(
      "vscode.diff",
      originalUri,
      modifiedUri,
      `Inline Edit: ${baseName} (Enter to accept, Escape to reject)`
    );
  }

  async accept(): Promise<void> {
    const edit = this.pendingEdit;
    if (!edit) {
      return;
    }

    this.pendingEdit = undefined;
    await vscode.commands.executeCommand("setContext", "inlineEdit.diffVisible", false);

    // Apply the edit to the real document
    const doc = await vscode.workspace.openTextDocument(edit.documentUri);
    const editor = await vscode.window.showTextDocument(doc);

    await editor.edit((editBuilder) => {
      editBuilder.replace(edit.range, edit.newCode);
    });

    // Close the diff tabs
    await this.closeDiffTabs();
    this.provider.clear();
  }

  async reject(): Promise<void> {
    this.pendingEdit = undefined;
    await vscode.commands.executeCommand("setContext", "inlineEdit.diffVisible", false);

    // Go back to the original document before closing diff tabs
    await this.closeDiffTabs();
    this.provider.clear();
  }

  private async closeDiffTabs(): Promise<void> {
    // Close all tabs with our scheme
    const tabsToClose: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input instanceof vscode.TabInputTextDiff &&
          (input.original.scheme === SCHEME || input.modified.scheme === SCHEME)
        ) {
          tabsToClose.push(tab);
        }
      }
    }
    if (tabsToClose.length > 0) {
      await vscode.window.tabGroups.close(tabsToClose);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
