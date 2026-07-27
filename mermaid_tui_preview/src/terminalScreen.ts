import { Terminal } from '@xterm/headless';

export interface TerminalDimensionsLike {
  columns: number;
  rows: number;
}

export class TerminalScreen {
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
