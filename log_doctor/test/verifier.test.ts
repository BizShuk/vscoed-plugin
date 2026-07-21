import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyFix } from '../src/verifier';
import { DiagnosticInfo } from '../src/types';

function makeDiag(over: Partial<DiagnosticInfo> = {}): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source: 'eslint',
    message: 'unused',
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    ...over,
  };
}

describe('verifyFix', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the representative diagnostic disappears and no new errors appear', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after: DiagnosticInfo[] = [];
    const result = verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).outcome).toBe('resolved');
  });

  it('detects regression when a new error appears in same file', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after = [
      makeDiag({ uri: 'file:///a.ts', message: 'old' }),
      makeDiag({ uri: 'file:///a.ts', message: 'new error', severity: 'error' }),
    ];
    const result = verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    await vi.advanceTimersByTimeAsync(1000);
    const r = await result;
    expect(r.outcome).toBe('regressed');
    expect(r.regressionCount).toBe(1);
  });

  it('marks unresolved when representative still present but no regression', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const result = verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).outcome).toBe('unresolved');
  });
});
