import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { createMermaidPreviewHTML } from './webview';

const PREVIEW_VIEW_TYPE = 'mermaidTuiPreview.diagram';

export class MermaidPreviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionURI: vscode.Uri) {}

  async show(source: string): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PREVIEW_VIEW_TYPE,
        'Mermaid Diagram',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(
              this.extensionURI,
              'out',
              'mermaid_tui_preview',
            ),
          ],
        },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    const scriptURI = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionURI,
        'out',
        'mermaid_tui_preview',
        'webview.js',
      ),
    );
    this.panel.webview.html = createMermaidPreviewHTML({
      source,
      scriptURI: scriptURI.toString(),
      cspSource: this.panel.webview.cspSource,
      nonce: randomBytes(16).toString('hex'),
    });
  }

  dispose(): void {
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
  }
}
