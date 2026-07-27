import * as vscode from 'vscode';
import { MermaidPreviewPanel } from './panel';
import {
  findMarkdownMermaidBlocks,
  selectMarkdownMermaidBlock,
} from './markdown';
import { MermaidDiagramStore } from './store';
import {
  captureMermaidStream,
  isSupportedTuiCommand,
  resolveTerminalDimensions,
  TerminalScreen,
} from './terminal';

const OPEN_LATEST_COMMAND = 'mermaidTuiPreview.openLatest';
const OPEN_MARKDOWN_COMMAND = 'mermaidTuiPreview.openMarkdown';
const OPEN_SOURCE_COMMAND = 'mermaidTuiPreview.openSource';
const CLEAR_ACTIVE_COMMAND = 'mermaidTuiPreview.clearActive';

class MermaidTerminalLink extends vscode.TerminalLink {
  readonly source: string;

  constructor(
    startIndex: number,
    length: number,
    source: string,
  ) {
    super(startIndex, length, 'Open with Mermaid Preview');
    this.source = source;
  }
}

class MermaidLinkProvider
  implements vscode.TerminalLinkProvider<MermaidTerminalLink>
{
  constructor(
    private readonly store: MermaidDiagramStore<vscode.Terminal>,
    private readonly previewPanel: MermaidPreviewPanel,
  ) {}

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
  ): MermaidTerminalLink[] {
    const resolved = this.store.resolveTerminalLink(
      context.terminal,
      context.line,
    );
    return resolved
      ? [
          new MermaidTerminalLink(
            resolved.startIndex,
            resolved.length,
            resolved.source,
          ),
        ]
      : [];
  }

  async handleTerminalLink(link: MermaidTerminalLink): Promise<void> {
    await this.previewPanel.show(link.source);
  }
}

class MermaidMarkdownLinkProvider
  implements vscode.DocumentLinkProvider<vscode.DocumentLink>
{
  provideDocumentLinks(
    document: vscode.TextDocument,
  ): vscode.DocumentLink[] {
    const blocks = findMarkdownMermaidBlocks(
      document.getText().split(/\r?\n/),
    );
    return blocks.map((block) => {
      const link = new vscode.DocumentLink(
        new vscode.Range(
          block.openingLine,
          block.openingStart,
          block.openingLine,
          block.openingEnd,
        ),
        createSourceCommandURI(block.source),
      );
      link.tooltip = 'Open Mermaid preview';
      return link;
    });
  }
}

export function registerMermaidTuiPreview(
  context: vscode.ExtensionContext,
): void {
  const store = new MermaidDiagramStore<vscode.Terminal>();
  const previewPanel = new MermaidPreviewPanel(context.extensionUri);

  try {
    context.subscriptions.push(
      previewPanel,
      vscode.window.onDidStartTerminalShellExecution((event) => {
        const commandLine = event.execution.commandLine.value;
        if (!isSupportedTuiCommand(commandLine)) {
          return;
        }

        const stream = event.execution.read();
        void captureTerminalMermaidStream(
          stream,
          event.terminal,
          store,
        ).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[MTUI] capture failed', error);
        });
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        store.clear(terminal);
      }),
      vscode.window.registerTerminalLinkProvider(
        new MermaidLinkProvider(store, previewPanel),
      ),
      vscode.languages.registerDocumentLinkProvider(
        { language: 'markdown' },
        new MermaidMarkdownLinkProvider(),
      ),
      vscode.commands.registerCommand(
        OPEN_SOURCE_COMMAND,
        async (source: unknown) => {
          if (typeof source === 'string') {
            await previewPanel.show(source);
          }
        },
      ),
      vscode.commands.registerCommand(OPEN_LATEST_COMMAND, async () => {
        const terminal = vscode.window.activeTerminal;
        const diagram = terminal ? store.latest(terminal) : undefined;
        if (!diagram) {
          await vscode.window.showInformationMessage(
            'No Mermaid diagram has been detected in the active terminal.',
          );
          return;
        }
        await previewPanel.show(diagram.source);
      }),
      vscode.commands.registerCommand(OPEN_MARKDOWN_COMMAND, async () => {
        await openActiveMarkdownDiagram(previewPanel);
      }),
      vscode.commands.registerCommand(CLEAR_ACTIVE_COMMAND, async () => {
        const terminal = vscode.window.activeTerminal;
        if (terminal) {
          store.clear(terminal);
        }
        previewPanel.dispose();
        await vscode.window.showInformationMessage(
          'Mermaid TUI Preview: cleared active cache and closed panel.',
        );
      }),
    );
  } catch (error: unknown) {
    console.error('Failed to register Mermaid TUI Preview', error);
  }
}

async function captureTerminalMermaidStream(
  stream: AsyncIterable<string>,
  terminal: vscode.Terminal,
  store: MermaidDiagramStore<vscode.Terminal>,
): Promise<void> {
  let processID: number | undefined;
  try {
    processID = await terminal.processId;
  } catch {
    processID = undefined;
  }
  const dimensions = await resolveTerminalDimensions(processID);
  await captureMermaidStream(
    stream,
    new TerminalScreen(dimensions),
    (diagrams) => store.record(terminal, diagrams),
  );
}

async function openActiveMarkdownDiagram(
  previewPanel: MermaidPreviewPanel,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    await vscode.window.showInformationMessage(
      'Open a Markdown file with a ```mermaid block first.',
    );
    return;
  }

  const blocks = findMarkdownMermaidBlocks(
    editor.document.getText().split(/\r?\n/),
  );
  const activeLine = editor.selection.active.line;
  const block =
    selectMarkdownMermaidBlock(blocks, activeLine) ??
    (blocks.length === 1 ? blocks[0] : undefined);
  if (!block) {
    await vscode.window.showInformationMessage(
      'Place the cursor inside a ```mermaid block first.',
    );
    return;
  }

  await previewPanel.show(block.source);
}

function createSourceCommandURI(source: string): vscode.Uri {
  return vscode.Uri.parse(
    `command:${OPEN_SOURCE_COMMAND}?${encodeURIComponent(JSON.stringify([source]))}`,
  );
}
