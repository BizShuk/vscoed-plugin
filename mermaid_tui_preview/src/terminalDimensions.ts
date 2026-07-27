import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TerminalDimensionsLike } from './terminalScreen';

const execFileAsync = promisify(execFile);

export interface TerminalDimensionCommandRunner {
  run(file: string, args: readonly string[]): Promise<string>;
}

const defaultRunner: TerminalDimensionCommandRunner = {
  run: async (file, args) => {
    const { stdout } = await execFileAsync(file, [...args], {
      encoding: 'utf8',
    });
    return stdout;
  },
};

export async function resolveTerminalDimensions(
  processID: number | undefined,
  platform: NodeJS.Platform = process.platform,
  runner: TerminalDimensionCommandRunner = defaultRunner,
): Promise<TerminalDimensionsLike | undefined> {
  if (!processID || !Number.isSafeInteger(processID) || processID < 1) {
    return undefined;
  }
  if (platform !== 'darwin' && platform !== 'linux') {
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
    if (!match) {
      return undefined;
    }

    const rows = Number(match[1]);
    const columns = Number(match[2]);
    if (rows < 1 || columns < 1) {
      return undefined;
    }
    return { columns, rows };
  } catch {
    return undefined;
  }
}
