export interface MermaidPreviewHTMLOptions {
  source: string;
  scriptURI: string;
  cspSource: string;
  nonce: string;
}

export function createMermaidPreviewHTML(
  options: MermaidPreviewHTMLOptions,
): string {
  const encodedSource = JSON.stringify(options.source).replace(
    /</g,
    '\\u003c',
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${options.cspSource} data:; style-src ${options.cspSource} 'unsafe-inline'; script-src 'nonce-${options.nonce}';"
  >
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mermaid Diagram</title>
  <style>
    html, body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
    }

    #viewport {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }

    #viewport.dragging {
      cursor: grabbing;
    }

    #diagram {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    #diagram svg {
      display: block;
      width: 100%;
      height: 100%;
      max-width: none;
      max-height: none;
      overflow: hidden;
    }

    #toolbar {
      position: fixed;
      z-index: 2;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-editorWidget-background);
      box-shadow: 0 2px 8px rgb(0 0 0 / 24%);
    }

    #toolbar button {
      min-width: 30px;
      height: 28px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      cursor: pointer;
    }

    #toolbar button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    #hint {
      padding: 0 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      white-space: nowrap;
    }

    #error {
      display: none;
      margin: 24px;
      padding: 12px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
      white-space: pre-wrap;
      user-select: text;
    }
  </style>
</head>
<body>
  <div id="viewport" aria-label="Interactive Mermaid diagram">
    <div id="diagram"></div>
  </div>
  <div id="toolbar">
    <span id="hint">Left-drag to move · Scroll to zoom</span>
    <button id="zoom-out" type="button" aria-label="Zoom out">−</button>
    <button id="reset" type="button">Reset</button>
    <button id="zoom-in" type="button" aria-label="Zoom in">+</button>
  </div>
  <pre id="error" role="alert"></pre>
  <script id="mermaid-source" type="application/json">${encodedSource}</script>
  <script nonce="${options.nonce}" src="${options.scriptURI}"></script>
</body>
</html>`;
}
