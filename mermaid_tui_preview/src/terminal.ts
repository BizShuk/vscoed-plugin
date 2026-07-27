import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Terminal } from '@xterm/headless';
import {
  detectMermaidDiagrams,
  type DetectedMermaidDiagram,
} from './detector';

const SUPPORTED_EXECUTABLES = new Set([
  'codex',
  'claude',
  'claude-code',
  'claudem',
]);
const WRAPPERS = new Set(['command', 'env', 'sudo']);
const execFileAsync = promisify(execFile);

export interface TerminalDimensionsLike {
  columns: number;
  rows: number;
}

export interface TerminalDimensionCommandRunner {
  run(file: string, args: readonly string[]): Promise<string>;
}

export interface TerminalScreenLike {
  write(data: string): Promise<readonly string[]>;
  dispose(): void;
}

const defaultRunner: TerminalDimensionCommandRunner = {
  run: async (file, args) => {
    const { stdout } = await execFileAsync(file, [...args], {
      encoding: 'utf8',
    });
    return stdout;
  },
};

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

    const executable = unquote(tokens[index] ?? '')
      .split('/')
      .at(-1);
    return executable !== undefined &&
      SUPPORTED_EXECUTABLES.has(executable);
  });
}

export async function resolveTerminalDimensions(
  processID: number | undefined,
  platform: NodeJS.Platform = process.platform,
  runner: TerminalDimensionCommandRunner = defaultRunner,
): Promise<TerminalDimensionsLike | undefined> {
  if (
    !processID ||
    !Number.isSafeInteger(processID) ||
    processID < 1 ||
    (platform !== 'darwin' && platform !== 'linux')
  ) {
    return undefined;
  }

  try {
    const tty = (
      await runner.run('ps', [
        '-p',
        String(processID),
        '-o',
        'tty=',
      ])
    ).trim();
    if (!/^(?:tty[a-zA-Z0-9._-]+|pts\/\d+)$/.test(tty)) {
      return undefined;
    }

    const size = (
      await runner.run('stty', [
        platform === 'darwin' ? '-f' : '-F',
        `/dev/${tty}`,
        'size',
      ])
    ).trim();
    const match = /^(\d+)\s+(\d+)$/.exec(size);
    const rows = Number(match?.[1]);
    const columns = Number(match?.[2]);
    return rows > 0 && columns > 0
      ? { columns, rows }
      : undefined;
  } catch {
    return undefined;
  }
}

export class TerminalScreen implements TerminalScreenLike {
  private readonly terminal: Terminal;

  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(dimensions?: TerminalDimensionsLike) {
    this.terminal = new Terminal({
      allowProposedApi: true,
      cols: Math.max(1, dimensions?.columns ?? 240),
      rows: Math.max(120, dimensions?.rows ?? 120),
      scrollback: 2_000,
    });
  }

  write(data: string): Promise<readonly string[]> {
    const result = this.pendingWrite
      .then(
        () =>
          new Promise<void>((resolve) => {
            this.terminal.write(data, resolve);
          }),
      )
      .then(() => this.snapshot());

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
      const bufferLine = buffer.getLine(index);
      const text = bufferLine?.translateToString(true) ?? '';
      if (bufferLine?.isWrapped && lines.length > 0) {
        lines[lines.length - 1] += text;
      } else {
        lines.push(text);
      }
    }
    while (lines.at(-1) === '') {
      lines.pop();
    }
    return lines;
  }
}

export async function captureMermaidStream(
  stream: AsyncIterable<string>,
  screen: TerminalScreenLike,
  onDetected: (
    diagrams: readonly DetectedMermaidDiagram[],
  ) => void,
): Promise<void> {
  try {
    for await (const data of stream) {
      for (const frame of splitAtFrameBoundaries(data)) {
        const diagrams = detectMermaidDiagrams(
          await screen.write(frame),
        );
        if (diagrams.length > 0) {
          onDetected(diagrams);
        }
      }
    }
  } finally {
    screen.dispose();
  }
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

function splitAtFrameBoundaries(data: string): readonly string[] {
  return data
    .split(/(?<=[\r\n])|(?=\u001b\[(?:\d*;\d*)?[Hf])/u)
    .filter((frame) => frame.length > 0);
}
