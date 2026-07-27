import * as vscode from 'vscode';
import { captureMermaidStream } from './capture';
import { isSupportedTuiCommand } from './commands';
import {
  resolveTerminalLink,
  selectTerminalLinkSource,
} from './links';
import {
  openMermaidPreview,
  type MermaidPreviewPort,
} from './preview';
import { MermaidPreviewPanel } from './panel';
import {
  findMarkdownMermaidBlocks,
  selectMarkdownMermaidBlock,
} from './markdown';
import { MermaidDiagramStore } from './store';
import { resolveTerminalDimensions } from './terminalDimensions';
import { TerminalScreen } from './terminalScreen';

const OPEN_LATEST_COMMAND = 'mermaidTuiPreview.openLatest';
const OPEN_MARKDOWN_COMMAND = 'mermaidTuiPreview.openMarkdown';
const OPEN_SOURCE_COMMAND = 'mermaidTuiPreview.openSource';

class MermaidTerminalLink extends vscode.TerminalLink {
  readonly sources: readonly string[];

  constructor(
    startIndex: number,
    length: number,
    sources: readonly string[],
  ) {
    super(
      startIndex,
      length,
      sources.length === 1
        ? 'Open with Mermaid Preview'
        : 'Choose a Mermaid diagram to preview',
    );
    this.sources = sources;
  }
}

interface MermaidSourceQuickPickItem extends vscode.QuickPickItem {
  source: string;
}

class MermaidLinkProvider
  implements vscode.TerminalLinkProvider<MermaidTerminalLink>
{
  constructor(
    private readonly store: MermaidDiagramStore<vscode.Terminal>,
    private readonly previewPort: MermaidPreviewPort,
  ) {}

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
  ): MermaidTerminalLink[] {
    const resolved = resolveTerminalLink(context.line, {
      marked: () => this.store.marked(context.terminal),
      matchingDirective: (directive, header) =>
        this.store.matchingDirective(
          context.terminal,
          directive,
          header,
        ),
    });
    return resolved
      ? [
          new MermaidTerminalLink(
            resolved.startIndex,
            resolved.length,
            resolved.sources,
          ),
        ]
      : [];
  }

  async handleTerminalLink(link: MermaidTerminalLink): Promise<void> {
    const source = await selectTerminalLinkSource(
      link.sources,
      async (sources) => {
        const selected = await vscode.window.showQuickPick(
          sources.map(createSourceQuickPickItem),
          {
            placeHolder:
              'This terminal line matches multiple Mermaid diagrams.',
          },
        );
        return selected?.source;
      },
    );
    if (source) {
      await openMermaidPreview(source, this.previewPort);
    }
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
  const previewPort = createPreviewPort(previewPanel);

  try {
    context.subscriptions.push(
      previewPanel,
      vscode.window.onDidStartTerminalShellExecution((event) => {
        if (!isSupportedTuiCommand(event.execution.commandLine.value)) {
          return;
        }

        const stream = event.execution.read();
        void captureTerminalMermaidStream(
          stream,
          event.terminal,
          store,
        ).catch((error: unknown) => {
          console.error('Mermaid TUI Preview capture failed', error);
        });
      }),
      vscode.window.onDidCloseTerminal((terminal) => {
        store.clear(terminal);
      }),
      vscode.window.registerTerminalLinkProvider(
        new MermaidLinkProvider(store, previewPort),
      ),
      vscode.languages.registerDocumentLinkProvider(
        { language: 'markdown' },
        new MermaidMarkdownLinkProvider(),
      ),
      vscode.commands.registerCommand(
        OPEN_SOURCE_COMMAND,
        async (source: unknown) => {
          if (typeof source === 'string') {
            await openMermaidPreview(source, previewPort);
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
        await openMermaidPreview(diagram.source, previewPort);
      }),
      vscode.commands.registerCommand(OPEN_MARKDOWN_COMMAND, async () => {
        await openActiveMarkdownDiagram(previewPort);
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
  previewPort: MermaidPreviewPort,
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

  await openMermaidPreview(block.source, previewPort);
}

function createSourceCommandURI(source: string): vscode.Uri {
  return vscode.Uri.parse(
    `command:${OPEN_SOURCE_COMMAND}?${encodeURIComponent(JSON.stringify([source]))}`,
  );
}

function createSourceQuickPickItem(
  source: string,
  index: number,
): MermaidSourceQuickPickItem {
  const lines = source
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return {
    label: `Diagram ${index + 1}: ${lines[0] ?? 'Mermaid'}`,
    description: lines[1]?.slice(0, 80),
    detail: lines.slice(1, 4).join(' · ').slice(0, 180),
    source,
  };
}

function createPreviewPort(
  previewPanel: MermaidPreviewPanel,
): MermaidPreviewPort {
  return {
    showPreview: async (source) => await previewPanel.show(source),
  };
}
