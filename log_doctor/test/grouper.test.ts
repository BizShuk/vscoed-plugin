import { describe, it, expect } from 'vitest';
import { sortAndCap } from '../src/grouper';
import { RepresentativeDiagnostic } from '../src/types';

function rep(uri: string, severity: 'error' | 'warning' | 'info' | 'hint'): RepresentativeDiagnostic {
  return {
    info: {
      uri,
      source: 'eslint',
      message: 'x',
      severity,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
    groupSize: 1,
    groupUris: [],
  };
}

describe('sortAndCap', () => {
  it('sorts error before warning before info before hint', () => {
    const list = [rep('a', 'hint'), rep('b', 'error'), rep('c', 'info'), rep('d', 'warning')];
    const out = sortAndCap(list, 10, () => {});
    expect(out.map((r) => r.info.severity)).toEqual(['error', 'warning', 'info', 'hint']);
  });

  it('caps to maxIssues and reports the count of dropped items', () => {
    const list = Array.from({ length: 5 }, (_, i) => rep(`u${i}`, 'error'));
    let dropped = 0;
    const out = sortAndCap(list, 3, (n) => (dropped = n));
    expect(out).toHaveLength(3);
    expect(dropped).toBe(2);
  });

  it('does not drop when list <= cap', () => {
    const list = [rep('a', 'error'), rep('b', 'warning')];
    let dropped = -1;
    sortAndCap(list, 10, (n) => (dropped = n));
    expect(dropped).toBe(0);
  });
});
