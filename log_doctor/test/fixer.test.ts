import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { fixOne } from '../src/fixer';
import { RepresentativeDiagnostic } from '../src/types';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

const rep: RepresentativeDiagnostic = {
  info: {
    uri: 'file:///proj/a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used.",
    severity: 'warning',
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
  },
  groupSize: 1,
  groupUris: [],
};

describe('fixOne', () => {
  it('returns proposals from provider and resolves uri to fsPath', async () => {
    (fs.readFile as any).mockResolvedValue('const foo = 1;\n');
    const provider = {
      name: 'claude' as const,
      send: vi.fn().mockResolvedValue(
        JSON.stringify({
          fixes: [
            {
              uri: 'file:///proj/a.ts',
              oldText: 'const foo = 1;',
              newText: '',
              rationale: 'unused',
            },
          ],
        }),
      ),
    };
    const result = await fixOne({ diagnostic: rep, provider });
    expect(result.fixes).toHaveLength(1);
    expect(result.fixes[0].uri).toBe('file:///proj/a.ts');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('returns empty array and error when response is not parseable', async () => {
    (fs.readFile as any).mockResolvedValue('const foo = 1;\n');
    const provider = { name: 'claude' as const, send: vi.fn().mockResolvedValue('not json') };
    const result = await fixOne({ diagnostic: rep, provider });
    expect(result.fixes).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('skips proposals whose uri does not match the diagnostic', async () => {
    (fs.readFile as any).mockResolvedValue('x');
    const provider = {
      name: 'claude' as const,
      send: vi.fn().mockResolvedValue(
        JSON.stringify({ fixes: [{ uri: 'file:///other.ts', oldText: 'a', newText: 'b' }] }),
      ),
    };
    const result = await fixOne({ diagnostic: rep, provider });
    expect(result.fixes).toEqual([]);
  });
});
