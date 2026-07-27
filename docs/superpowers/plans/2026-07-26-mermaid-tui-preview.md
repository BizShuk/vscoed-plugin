# Mermaid TUI Preview Implementation Plan

> `For agentic workers:` required sub-skill: use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

`Goal:` Listen to Codex and Claude terminal executions, reconstruct their ANSI-rendered TUI screen, detect Mermaid diagrams, and expose terminal links that open the detected source through `Mermaid Preview: Preview Diagram`.

`Architecture:` Add a sibling `mermaid_tui_preview/` feature. A headless xterm instance reconstructs cursor movement and screen redraws from `TerminalShellExecution.read()`. Pure detector and store modules extract diagrams from Claude's visible `mermaid` marker or Codex's visible Mermaid directive, while the VS Code adapter registers terminal links and opens an untitled `mermaid` document before invoking `preview.mermaidChart.preview`.

`Tech Stack:` TypeScript, VS Code Extension API 1.93+, `@xterm/headless`, Vitest, esbuild.

`2026-07-27 follow-up:` 外部 Mermaid Preview bridge 已由內建 webview 取代，讓左鍵
拖曳成為預設互動；現況以 `mermaid_tui_preview/CLAUDE.md` 為準。

## Global Constraints

- Support both the locally verified Codex TUI format (`• flowchart TD`) and Claude TUI format (`⏺ mermaid` followed by source).
- Treat ANSI cursor control as terminal state, not text to delete.
- Require VS Code 1.93+ because stable `TerminalShellExecution.read()` arrived in 1.93.
- Reuse the installed `vstirbu.vscode-mermaid-preview` command `preview.mermaidChart.preview`.
- Keep all feature logic under `mermaid_tui_preview/`; root `src/extension.ts` remains orchestration only.
- Do not add configurable paths or alternate preview renderers.
- Do not commit.

---

### Task 1: Pure Mermaid block detection

`Files:`

- Create: `mermaid_tui_preview/src/detector.ts`
- Test: `mermaid_tui_preview/test/detector.test.ts`

`Interfaces:`

- Consumes: reconstructed terminal lines as `readonly string[]`.
- Produces: `detectMermaidDiagrams(lines): DetectedMermaidDiagram[]`.

- [x] Step 1: Write failing tests for Claude marker blocks, Codex bullet blocks, literal fenced blocks, partial output, and unrelated prose.

```typescript
import { describe, expect, it } from 'vitest';
import { detectMermaidDiagrams } from '../src/detector';

describe('detectMermaidDiagrams', () => {
  it('extracts a Claude marker block', () => {
    expect(detectMermaidDiagrams([
      '⏺ mermaid',
      '  flowchart TD',
      '      A[Start] --> B[Done]',
      '',
      '✻ Sautéed for 2s',
    ])[0]?.source).toBe('flowchart TD\n    A[Start] --> B[Done]');
  });

  it('extracts a Codex directive block', () => {
    expect(detectMermaidDiagrams([
      '• flowchart TD',
      '      A[Start] --> B[Done]',
      '',
      '› Improve documentation',
    ])[0]?.source).toBe('flowchart TD\nA[Start] --> B[Done]');
  });
});
```

- [x] Step 2: Run `npx vitest run mermaid_tui_preview/test/detector.test.ts` and confirm RED because `detector.ts` does not exist.

- [x] Step 3: Implement directive recognition and indentation-aware block extraction.

```typescript
const DIRECTIVE_SOURCE = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram(?:-v2)?',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4(?:Context|Container|Component|Dynamic|Deployment)',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
].join('|');

const DIRECTIVE_AT_START = new RegExp(
  `^\\s*(${DIRECTIVE_SOURCE})(?=\\s|$|[:;{])`,
  'i',
);
const DIRECTIVE_IN_LINE = new RegExp(
  `(${DIRECTIVE_SOURCE})(?=\\s|$|[:;{])`,
  'i',
);

export interface DetectedMermaidDiagram {
  source: string;
  directive: string;
  marker: string | undefined;
}

export function findMermaidDirectiveInLine(
  line: string,
): { directive: string; startIndex: number; length: number } | undefined {
  const match = DIRECTIVE_IN_LINE.exec(line);
  if (!match?.[1] || match.index === undefined) {
    return undefined;
  }
  return {
    directive: match[1],
    startIndex: match.index,
    length: match[1].length,
  };
}

export function detectMermaidDiagrams(
  lines: readonly string[],
): DetectedMermaidDiagram[] {
  const diagrams: DetectedMermaidDiagram[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const visible = stripBullet(lines[index] ?? '').trim();
    const fence = /^`{3,}\s*mermaid\s*$/i.test(visible);
    const marker = fence || /^mermaid$/i.test(visible);

    if (marker) {
      const extracted = extractFollowing(lines, index + 1, fence);
      const directive = findDirective(extracted.source);
      if (directive) {
        diagrams.push({
          source: extracted.source,
          directive,
          marker: 'mermaid',
        });
      }
      index = Math.max(index, extracted.endIndex);
      continue;
    }

    const content = stripBullet(lines[index] ?? '').trimStart();
    const direct = DIRECTIVE_AT_START.exec(content);
    if (!direct?.[1]) {
      continue;
    }

    const continuation = extractFollowing(lines, index + 1, false);
    const source = [content.trimEnd(), ...continuation.lines].join('\n').trimEnd();
    diagrams.push({
      source,
      directive: direct[1],
      marker: undefined,
    });
    index = Math.max(index, continuation.endIndex);
  }

  return diagrams.filter(
    (diagram, index) =>
      diagrams.findIndex((candidate) => candidate.source === diagram.source) === index,
  );
}

function stripBullet(line: string): string {
  return line.replace(/^\s*[•●◦⏺]\s+/u, '');
}

function findDirective(source: string): string | undefined {
  for (const line of source.split('\n')) {
    const match = DIRECTIVE_AT_START.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function extractFollowing(
  lines: readonly string[],
  startIndex: number,
  fenced: boolean,
): { source: string; lines: string[]; endIndex: number } {
  const first = lines.findIndex(
    (line, index) => index >= startIndex && line.trim().length > 0,
  );
  if (first < startIndex) {
    return { source: '', lines: [], endIndex: startIndex - 1 };
  }

  const baseIndent = indentation(lines[first] ?? '');
  const collected: string[] = [];
  let endIndex = first - 1;
  let pendingBlankLines = 0;

  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fenced && /^\s*`{3,}\s*$/.test(line)) {
      endIndex = index;
      break;
    }

    if (line.trim().length === 0) {
      pendingBlankLines += 1;
      continue;
    }

    if (!fenced && index > first && indentation(line) < baseIndent) {
      break;
    }
    if (!fenced && pendingBlankLines > 0 && baseIndent === 0) {
      break;
    }

    while (pendingBlankLines > 0) {
      collected.push('');
      pendingBlankLines -= 1;
    }
    collected.push(removeIndent(line, baseIndent).trimEnd());
    endIndex = index;
  }

  const source = collected.join('\n').trimEnd();
  return { source, lines: collected, endIndex };
}

function indentation(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function removeIndent(line: string, width: number): string {
  let index = 0;
  while (index < line.length && index < width && /\s/.test(line[index] ?? '')) {
    index += 1;
  }
  return line.slice(index);
}
```

- [x] Step 4: Re-run the focused test and confirm all detector cases pass.

### Task 2: ANSI terminal screen reconstruction

`Files:`

- Modify: `package.json`
- Create: `mermaid_tui_preview/src/terminalScreen.ts`
- Test: `mermaid_tui_preview/test/terminalScreen.test.ts`

`Interfaces:`

- Consumes: raw chunks from `TerminalShellExecution.read()`.
- Produces: `TerminalScreen.write(data): Promise<readonly string[]>`.

- [x] Step 1: Add `@xterm/headless@5.5.0`.

- [x] Step 2: Write a failing test using reduced raw captures from the live Codex and Claude TUI probes.

```typescript
const claudeFrame =
  '\u001b[H\r\u001b[12B⏺\u001b[3Gmermaid\r' +
  '\u001b[2C\u001b[1Bflowchart\u001b[13GTD\r' +
  '\u001b[6C\u001b[1BA[Start]\u001b[16G-->\u001b[20GB[Done]';

const lines = await screen.write(claudeFrame);
expect(lines).toContain('⏺ mermaid');
expect(lines).toContain('  flowchart TD');
```

- [x] Step 3: Run `npx vitest run mermaid_tui_preview/test/terminalScreen.test.ts` and confirm RED because `TerminalScreen` is absent.

- [x] Step 4: Wrap the headless terminal with serialized writes, a 240 by 120 reconstruction surface, trimmed snapshots, and disposal.

```typescript
import { Terminal } from '@xterm/headless';

export class TerminalScreen {
  private readonly terminal = new Terminal({
    allowProposedApi: true,
    cols: 240,
    rows: 120,
    scrollback: 2_000,
  });

  private pendingWrite: Promise<void> = Promise.resolve();

  write(data: string): Promise<readonly string[]> {
    const result = this.pendingWrite.then(
      () =>
        new Promise<void>((resolve) => {
          this.terminal.write(data, resolve);
        }),
    ).then(() => this.snapshot());

    this.pendingWrite = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private snapshot(): readonly string[] {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    }
    while (lines.at(-1) === '') {
      lines.pop();
    }
    return lines;
  }
}
```

- [x] Step 5: Re-run the focused test and confirm the raw captures reconstruct into stable visible lines.

### Task 3: Diagram cache and link resolution

`Files:`

- Create: `mermaid_tui_preview/src/store.ts`
- Test: `mermaid_tui_preview/test/store.test.ts`

`Interfaces:`

- Consumes: terminal identity plus detector results.
- Produces: latest diagram and diagram matching a visible Mermaid directive.

- [x] Step 1: Write failing tests that prove incremental one-line output is replaced by the longer block, exact duplicates do not grow the cache, and a cache keeps at most 20 diagrams per terminal.

- [x] Step 2: Run `npx vitest run mermaid_tui_preview/test/store.test.ts` and confirm RED.

- [x] Step 3: Implement `MermaidDiagramStore<K extends object>` with a `WeakMap`, prefix-aware incremental replacement, most-recent ordering, and `clear(key)`.

```typescript
import type { DetectedMermaidDiagram } from './detector';

export class MermaidDiagramStore<K extends object> {
  private readonly diagrams = new WeakMap<K, DetectedMermaidDiagram[]>();

  constructor(private readonly maximumPerKey = 20) {}

  record(key: K, detected: readonly DetectedMermaidDiagram[]): void {
    const current = [...(this.diagrams.get(key) ?? [])];
    for (const diagram of detected) {
      const exactIndex = current.findIndex((item) => item.source === diagram.source);
      if (exactIndex >= 0) {
        current.splice(exactIndex, 1);
        current.push(diagram);
        continue;
      }

      const progressiveIndex = current.findIndex(
        (item) =>
          item.directive.toLowerCase() === diagram.directive.toLowerCase() &&
          (item.source.startsWith(diagram.source) ||
            diagram.source.startsWith(item.source)),
      );
      if (progressiveIndex >= 0) {
        current.splice(progressiveIndex, 1);
      }
      current.push(diagram);
    }
    this.diagrams.set(key, current.slice(-this.maximumPerKey));
  }

  latest(key: K): DetectedMermaidDiagram | undefined {
    return this.diagrams.get(key)?.at(-1);
  }

  matchingDirective(
    key: K,
    directive: string,
  ): DetectedMermaidDiagram | undefined {
    return [...(this.diagrams.get(key) ?? [])].reverse().find(
      (item) => item.directive.toLowerCase() === directive.toLowerCase(),
    );
  }

  clear(key: K): void {
    this.diagrams.delete(key);
  }
}
```

- [x] Step 4: Re-run the focused store tests and confirm they pass.

### Task 4: VS Code listener, terminal links, and Mermaid Preview bridge

`Files:`

- Create: `mermaid_tui_preview/src/commands.ts`
- Create: `mermaid_tui_preview/src/register.ts`
- Test: `mermaid_tui_preview/test/commands.test.ts`
- Modify: `src/extension.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

`Interfaces:`

- Consumes: `window.onDidStartTerminalShellExecution`, terminal link provider callbacks, and `vstirbu.vscode-mermaid-preview`.
- Produces: `registerMermaidTuiPreview(context): void` and command `mermaidTuiPreview.openLatest`.

- [x] Step 1: Write failing command-filter tests for `codex`, absolute-path `codex --no-alt-screen`, `claude --ide`, unrelated commands, and prompts that merely mention the names.

- [x] Step 2: Run the focused command-filter test and confirm RED.

- [x] Step 3: Implement `isSupportedTuiCommand(commandLine)` and the capture loop. Call `execution.read()` immediately inside the start-event callback, feed each chunk into `TerminalScreen`, detect diagrams, and update the per-terminal store.

```typescript
const SUPPORTED_EXECUTABLES = new Set(['codex', 'claude', 'claude-code']);
const WRAPPERS = new Set(['command', 'env', 'sudo']);

export function isSupportedTuiCommand(commandLine: string): boolean {
  return commandLine.split(/&&|\|\||[;|]/).some((segment) => {
    const tokens = segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')) {
      index += 1;
    }
    while (WRAPPERS.has(unquote(tokens[index] ?? ''))) {
      index += 1;
      while (
        (tokens[index] ?? '').startsWith('-') ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? '')
      ) {
        index += 1;
      }
    }
    const executable = unquote(tokens[index] ?? '').split('/').at(-1) ?? '';
    return SUPPORTED_EXECUTABLES.has(executable);
  });
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
```

- [x] Step 4: Register a terminal link provider. Link the visible `mermaid` marker when it maps to the latest diagram and link recognized directive words such as `flowchart` or `sequenceDiagram`.

```typescript
class MermaidTerminalLink extends vscode.TerminalLink {
  constructor(
    startIndex: number,
    length: number,
    readonly source: string,
  ) {
    super(startIndex, length, 'Open with Mermaid Preview');
  }
}

class MermaidLinkProvider
  implements vscode.TerminalLinkProvider<MermaidTerminalLink>
{
  constructor(
    private readonly store: MermaidDiagramStore<vscode.Terminal>,
  ) {}

  provideTerminalLinks(
    context: vscode.TerminalLinkContext,
  ): MermaidTerminalLink[] {
    const directive = findMermaidDirectiveInLine(context.line);
    if (directive && isTuiPrefix(context.line.slice(0, directive.startIndex))) {
      const diagram = this.store.matchingDirective(
        context.terminal,
        directive.directive,
      );
      if (diagram) {
        return [
          new MermaidTerminalLink(
            directive.startIndex,
            directive.length,
            diagram.source,
          ),
        ];
      }
    }

    const marker = /\bmermaid\b/i.exec(context.line);
    const latest = this.store.latest(context.terminal);
    if (marker && latest && isTuiPrefix(context.line.slice(0, marker.index))) {
      return [
        new MermaidTerminalLink(marker.index, marker[0].length, latest.source),
      ];
    }
    return [];
  }

  async handleTerminalLink(link: MermaidTerminalLink): Promise<void> {
    await openMermaidPreview(link.source);
  }
}

function isTuiPrefix(prefix: string): boolean {
  return /^[\s•●◦⏺]*$/u.test(prefix);
}
```

- [x] Step 5: Implement preview opening.

```typescript
async function openMermaidPreview(source: string): Promise<void> {
  if (!vscode.extensions.getExtension('vstirbu.vscode-mermaid-preview')) {
    await vscode.window.showErrorMessage(
      'Install Mermaid Preview (vstirbu.vscode-mermaid-preview) first.',
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'mermaid',
    content: `${source.trim()}\n`,
  });
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });
  await vscode.commands.executeCommand('preview.mermaidChart.preview');
}
```

- [x] Step 6: Register `mermaidTuiPreview.openLatest`, activate on `onStartupFinished`, declare `vstirbu.vscode-mermaid-preview` as an extension dependency, and raise the engine floor to `^1.93.0`.

```typescript
export function registerMermaidTuiPreview(
  context: vscode.ExtensionContext,
): void {
  const store = new MermaidDiagramStore<vscode.Terminal>();

  context.subscriptions.push(
    vscode.window.onDidStartTerminalShellExecution((event) => {
      if (!isSupportedTuiCommand(event.execution.commandLine.value)) {
        return;
      }
      const stream = event.execution.read();
      void captureExecution(event.terminal, stream, store);
    }),
    vscode.window.onDidCloseTerminal((terminal) => store.clear(terminal)),
    vscode.window.registerTerminalLinkProvider(
      new MermaidLinkProvider(store),
    ),
    vscode.commands.registerCommand(
      'mermaidTuiPreview.openLatest',
      async () => {
        const terminal = vscode.window.activeTerminal;
        const diagram = terminal ? store.latest(terminal) : undefined;
        if (!diagram) {
          await vscode.window.showInformationMessage(
            'No Mermaid diagram has been detected in the active terminal.',
          );
          return;
        }
        await openMermaidPreview(diagram.source);
      },
    ),
  );
}

async function captureExecution(
  terminal: vscode.Terminal,
  stream: AsyncIterable<string>,
  store: MermaidDiagramStore<vscode.Terminal>,
): Promise<void> {
  const screen = new TerminalScreen();
  try {
    for await (const data of stream) {
      const lines = await screen.write(data);
      store.record(terminal, detectMermaidDiagrams(lines));
    }
  } catch (error: unknown) {
    console.error('Mermaid TUI Preview capture failed', error);
  } finally {
    screen.dispose();
  }
}
```

- [x] Step 7: Add the feature paths to TypeScript and Vitest includes, then call `registerMermaidTuiPreview(context)` from the root orchestrator.

- [x] Step 8: Run all focused feature tests and confirm they pass.

### Task 5: Canonical documentation and package verification

`Files:`

- Create: `mermaid_tui_preview/CLAUDE.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

`Interfaces:`

- Consumes: verified behavior and runtime limits from Tasks 1 through 4.
- Produces: synchronized project overview, technical context, prerequisites, and usage instructions.

- [x] Step 1: Document the capture flow, the VS Code 1.93 shell-integration requirement, Codex versus Claude render differences, the terminal link interaction, and the Mermaid Preview dependency.

- [x] Step 2: Run `npm test`.

- [x] Step 3: Run `npm run typecheck`.

- [x] Step 4: Run `npm run build`.

- [x] Step 5: Run `npm run package` and inspect the VSIX file list for the bundled feature and manifest declarations.

- [x] Step 6: Install the generated VSIX into Antigravity IDE with `agy-ide --install-extension <vsix> --force`, then verify the installed extension appears in `agy-ide --list-extensions --show-versions`.
