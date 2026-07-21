import { describe, it, expect, vi } from 'vitest';
import { collectDiagnostics } from '../src/collector';

function makeDiag(over: any = {}): any {
  return {
    source: 'eslint',
    code: { value: 'no-unused-vars' },
    message: 'x is defined but never used',
    severity: 1, // Warning
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    ...over,
  };
}

describe('collectDiagnostics', () => {
  it('maps vscode diagnostics to DiagnosticInfo', () => {
    const uri = { fsPath: '/proj/a.ts', toString: () => 'file:///proj/a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag()]]]));
    const info = collectDiagnostics(getDiagnostics as any);
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      uri: 'file:///proj/a.ts',
      source: 'eslint',
      code: 'no-unused-vars',
      message: 'x is defined but never used',
      severity: 'warning',
    });
  });

  it('skips diagnostics with no source', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ source: undefined })]]]));
    expect(collectDiagnostics(getDiagnostics as any)).toEqual([]);
  });

  it('skips hint-severity diagnostics', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    // Hint = 4
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ severity: 4 })]]]));
    expect(collectDiagnostics(getDiagnostics as any)).toEqual([]);
  });

  it('handles numeric code values', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ code: 2304 })]]]));
    const info = collectDiagnostics(getDiagnostics as any);
    expect(info[0].code).toBe(2304);
  });
});
