import { describe, expect, it } from 'vitest';
import {
  resolveTerminalDimensions,
  type TerminalDimensionCommandRunner,
} from '../src/terminal';

describe('resolveTerminalDimensions', () => {
  it('reads the macOS PTY dimensions for a terminal process', async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const runner: TerminalDimensionCommandRunner = {
      run: async (file, args) => {
        calls.push({ file, args });
        return file === 'ps' ? 'ttys153\n' : '30 80\n';
      },
    };

    await expect(
      resolveTerminalDimensions(70075, 'darwin', runner),
    ).resolves.toEqual({
      columns: 80,
      rows: 30,
    });
    expect(calls).toEqual([
      {
        file: 'ps',
        args: ['-p', '70075', '-o', 'tty='],
      },
      {
        file: 'stty',
        args: ['-f', '/dev/ttys153', 'size'],
      },
    ]);
  });

  it('returns undefined rather than using an unsafe PTY path', async () => {
    const runner: TerminalDimensionCommandRunner = {
      run: async () => '../../tmp/injected\n',
    };

    await expect(
      resolveTerminalDimensions(70075, 'darwin', runner),
    ).resolves.toBeUndefined();
  });
});
