import { describe, expect, it } from 'vitest';
import { isSupportedTuiCommand } from '../src/commands';

describe('isSupportedTuiCommand', () => {
  it.each([
    'codex',
    'codex --no-alt-screen',
    '/opt/homebrew/bin/codex resume --last',
    'claude --ide',
    'claude-code',
    'claudem',
    '/Users/shuk/bin/claudem --ide',
    'env CLAUDE_CODE_SIMPLE=1 claude',
    'command codex',
    'cd /tmp && codex --no-alt-screen',
    '\"/opt/local/bin/claude\" --ide',
  ])('accepts a Codex or Claude TUI execution: %s', (commandLine) => {
    expect(isSupportedTuiCommand(commandLine)).toBe(true);
  });

  it.each([
    'echo codex',
    'printf \"claude\"',
    'npm test',
    'echo claude | sed s/a/b/',
    'node script.js --message=codex',
  ])('rejects an unrelated command: %s', (commandLine) => {
    expect(isSupportedTuiCommand(commandLine)).toBe(false);
  });
});
