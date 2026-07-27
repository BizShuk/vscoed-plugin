import { afterEach, describe, expect, it } from 'vitest';
import { TerminalScreen } from '../src/terminal';

const screens: TerminalScreen[] = [];

afterEach(() => {
  for (const screen of screens) {
    screen.dispose();
  }
  screens.length = 0;
});

describe('TerminalScreen', () => {
  it('reconstructs the cursor-positioned Claude TUI Mermaid frame', async () => {
    const screen = new TerminalScreen();
    screens.push(screen);

    const raw =
      '\u001b[?1049h\u001b[H\r\u001b[12B⏺\u001b[3Gmermaid\r' +
      '\u001b[2C\u001b[1Bflowchart\u001b[13GTD\r' +
      '\u001b[6C\u001b[1BA[Start]\u001b[16G-->\u001b[20GB[Done]';

    const lines = await screen.write(raw);

    expect(lines).toContain('⏺ mermaid');
    expect(lines).toContain('  flowchart TD');
    expect(lines).toContain('      A[Start] --> B[Done]');
  });

  it('applies incremental Codex TUI screen updates in order', async () => {
    const screen = new TerminalScreen();
    screens.push(screen);

    await screen.write(
      '\u001b[17;1H\r\u001b[K\u001b[2m• \u001b[22mflowchart TD',
    );
    const lines = await screen.write(
      '\u001b[18;1H\r\u001b[K      A[Start] --> B[Done]',
    );

    expect(lines).toContain('• flowchart TD');
    expect(lines).toContain('      A[Start] --> B[Done]');
  });

  it('uses actual columns and rejoins wrapped rows as one logical line', async () => {
    const screen = new TerminalScreen({ columns: 10, rows: 3 });
    screens.push(screen);

    const lines = await screen.write(
      '\u001b[?1049h\u001b[H1234567890A\u001b[1AZ',
    );

    expect(lines).toEqual(['1Z34567890A']);
  });
});
