import { describe, it, expect } from 'vitest';
import { signatureOf, groupBySignature, pickRepresentative } from '../src/dedup';
import { DiagnosticInfo } from '../src/types';

function diag(over: Partial<DiagnosticInfo>): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used. (no-unused-vars)",
    severity: 'warning',
    range: {
      start: { line: 4, character: 0 },
      end: { line: 4, character: 3 },
    },
    ...over,
  };
}

describe('signatureOf', () => {
  it('strips variable names in single quotes', () => {
    const a = diag({ message: "Variable 'foo' is defined but never used." });
    const b = diag({ message: "Variable 'bar' is defined but never used." });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips file paths', () => {
    const a = diag({ message: 'Error at /Users/x/project/a.ts:12' });
    const b = diag({ message: 'Error at /Users/y/project/b.ts:99' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips line:col markers', () => {
    const a = diag({ message: 'fail at 12:5' });
    const b = diag({ message: 'fail at 7:1' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips hex addresses and large numbers', () => {
    const a = diag({ message: 'ptr 0xdeadbeef offset 1234567' });
    const b = diag({ message: 'ptr 0xcafebabe offset 7654321' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('uses source + code as part of signature', () => {
    const a = diag({ source: 'eslint', code: 'no-unused-vars' });
    const b = diag({ source: 'eslint', code: 'no-undef' });
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('uses source alone when code is missing', () => {
    const a = diag({ source: 'eslint', code: undefined });
    const b = diag({ source: 'tsc', code: undefined });
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('strips Windows paths with trailing line:col', () => {
    const a = diag({ message: 'Error at C:\\proj\\a.ts:42' });
    const b = diag({ message: 'Error at C:\\other\\b.ts:7' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });
});

describe('groupBySignature', () => {
  it('groups diagnostics with identical signatures', () => {
    const list: DiagnosticInfo[] = [
      diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" }),
      diag({ uri: 'file:///b.ts', message: "Variable 'bar' unused" }),
      diag({ uri: 'file:///c.ts', message: "Variable 'baz' unused" }),
    ];
    const groups = groupBySignature(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupSize).toBe(3);
    expect(groups[0].groupUris.sort()).toEqual(['file:///b.ts', 'file:///c.ts']);
  });

  it('keeps different signatures in different groups', () => {
    const list: DiagnosticInfo[] = [
      diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" }),
      diag({ uri: 'file:///a.ts', message: "Variable 'bar' is not defined" }),
    ];
    const groups = groupBySignature(list);
    expect(groups).toHaveLength(2);
  });

  it('preserves input order — first item is the representative', () => {
    const list: DiagnosticInfo[] = [
      diag({ uri: 'file:///z.ts', message: "Variable 'x' unused" }),
      diag({ uri: 'file:///a.ts', message: "Variable 'y' unused" }),
      diag({ uri: 'file:///m.ts', message: "Variable 'z' unused" }),
    ];
    const groups = groupBySignature(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].info.uri).toBe('file:///z.ts');
    expect(groups[0].groupUris.sort()).toEqual(['file:///a.ts', 'file:///m.ts']);
  });
});

describe('pickRepresentative', () => {
  it('returns the first item as representative with extras in groupUris', () => {
    const a = diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" });
    const b = diag({ uri: 'file:///b.ts', message: "Variable 'bar' unused" });
    const rep = pickRepresentative([a, b]);
    expect(rep.info).toBe(a);
    expect(rep.groupSize).toBe(2);
    expect(rep.groupUris).toEqual(['file:///b.ts']);
  });

  it('throws on empty group', () => {
    expect(() => pickRepresentative([])).toThrow(/empty/i);
  });
});
