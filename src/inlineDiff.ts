import * as vscode from "vscode";

interface DiffLine {
  type: "unchanged" | "deleted" | "added";
  text: string;
}

/**
 * LCS-based line diff. Returns an interleaved list of unchanged, deleted,
 * and added lines that can be rendered inline in the editor.
 */
function computeDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const stack: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "unchanged", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "added", text: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: "deleted", text: oldLines[i - 1] });
      i--;
    }
  }

  return stack.reverse();
}

interface PendingDiff {
  documentUri: vscode.Uri;
  /** The original selected text, used to restore on reject */
  originalText: string;
  /** The range in the document currently occupied by the merged diff view */
  mergedRange: vscode.Range;
  /** The interleaved diff lines */
  diffLines: DiffLine[];
}

export class InlineDiffView {
  private deletedType: vscode.TextEditorDecorationType;
  private addedType: vscode.TextEditorDecorationType;
  private statusBarItem: vscode.StatusBarItem;
  private pending: PendingDiff | undefined;
  private applying = false;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.deletedType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor(
        "diffEditor.removedLineBackground"
      ),
      overviewRulerColor: new vscode.ThemeColor(
        "editorOverviewRuler.deletedForeground"
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });

    this.addedType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor(
        "diffEditor.insertedLineBackground"
      ),
      overviewRulerColor: new vscode.ThemeColor(
        "editorOverviewRuler.addedForeground"
      ),
      overviewRulerLane: vscode.OverviewRulerLane.Full,
    });

    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      1000
    );
    this.statusBarItem.text =
      "$(check) Accept (Enter)  $(x) Reject (Esc)";
    this.statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );

    // If the document is modified by the user (not by us), dismiss the diff
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          this.pending &&
          !this.applying &&
          e.document.uri.toString() === this.pending.documentUri.toString() &&
          e.contentChanges.length > 0
        ) {
          this.clearDecorations();
          this.clearState();
        }
      })
    );
  }

  async show(
    document: vscode.TextDocument,
    range: vscode.Range,
    newCode: string
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      return;
    }

    const originalText = document.getText(range);
    const oldLines = originalText.split("\n");
    const newLines = newCode.split("\n");
    const diffLines = computeDiff(oldLines, newLines);
    const mergedText = diffLines.map((l) => l.text).join("\n");

    // Replace selection with the merged (interleaved) view
    this.applying = true;
    await editor.edit((eb) => eb.replace(range, mergedText));
    this.applying = false;

    // Compute the range now occupied by the merged view
    const startLine = range.start.line;
    const startChar = range.start.character;
    const lastText = diffLines[diffLines.length - 1]?.text ?? "";
    const endLine = startLine + diffLines.length - 1;
    const endChar =
      diffLines.length === 1 ? startChar + lastText.length : lastText.length;
    const mergedRange = new vscode.Range(startLine, startChar, endLine, endChar);

    this.pending = {
      documentUri: document.uri,
      originalText,
      mergedRange,
      diffLines,
    };

    // Apply red/green decorations
    const deletedRanges: vscode.Range[] = [];
    const addedRanges: vscode.Range[] = [];
    for (let i = 0; i < diffLines.length; i++) {
      const docLine = startLine + i;
      const r = new vscode.Range(docLine, 0, docLine, 0);
      if (diffLines[i].type === "deleted") {
        deletedRanges.push(r);
      } else if (diffLines[i].type === "added") {
        addedRanges.push(r);
      }
    }
    editor.setDecorations(this.deletedType, deletedRanges);
    editor.setDecorations(this.addedType, addedRanges);

    this.statusBarItem.show();
    editor.revealRange(
      mergedRange,
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );

    await vscode.commands.executeCommand(
      "setContext",
      "inlineEdit.diffVisible",
      true
    );
  }

  async accept(): Promise<void> {
    if (!this.pending) {
      return;
    }
    const { documentUri, mergedRange, diffLines } = this.pending;

    // Keep only unchanged + added lines
    const acceptedText = diffLines
      .filter((l) => l.type !== "deleted")
      .map((l) => l.text)
      .join("\n");

    const doc = await vscode.workspace.openTextDocument(documentUri);
    const editor = await vscode.window.showTextDocument(doc);

    this.applying = true;
    await editor.edit((eb) => eb.replace(mergedRange, acceptedText));
    this.applying = false;

    this.clearDecorations();
    this.clearState();
  }

  async reject(): Promise<void> {
    if (!this.pending) {
      return;
    }
    const { documentUri, mergedRange, originalText } = this.pending;

    const doc = await vscode.workspace.openTextDocument(documentUri);
    const editor = await vscode.window.showTextDocument(doc);

    this.applying = true;
    await editor.edit((eb) => eb.replace(mergedRange, originalText));
    this.applying = false;

    this.clearDecorations();
    this.clearState();
  }

  private clearState() {
    this.pending = undefined;
    this.statusBarItem.hide();
    vscode.commands.executeCommand(
      "setContext",
      "inlineEdit.diffVisible",
      false
    );
  }

  private clearDecorations() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      editor.setDecorations(this.deletedType, []);
      editor.setDecorations(this.addedType, []);
    }
  }

  dispose() {
    this.deletedType.dispose();
    this.addedType.dispose();
    this.statusBarItem.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
