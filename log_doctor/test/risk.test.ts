import { describe, it, expect } from 'vitest';
import { classifyBySource, patchLineCount, decideRisk } from '../src/risk';
import { DiagnosticInfo, FixProposal } from '../src/types';

function diag(source: string): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source,
    message: 'x',
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  };
}

describe('classifyBySource', () => {
  it('returns low when source in autoApplySources', () => {
    expect(classifyBySource(diag('eslint'), ['eslint', 'prettier'])).toBe('low');
  });

  it('returns high when source not in autoApplySources', () => {
    expect(classifyBySource(diag('tsc'), ['eslint'])).toBe('high');
  });

  it('matches case-insensitively', () => {
    expect(classifyBySource(diag('ESLint'), ['eslint'])).toBe('low');
  });
});

describe('patchLineCount', () => {
  it('returns added line count for simple replace', () => {
    const fix: FixProposal = { uri: 'u', oldText: 'a', newText: 'b' };
    expect(patchLineCount(fix)).toBe(0);
  });

  it('counts newlines in newText minus newlines in oldText, floored at 0', () => {
    const fix: FixProposal = {
      uri: 'u',
      oldText: 'const x = 1;',
      newText: 'const x = 1;\nconst y = 2;\nconst z = 3;',
    };
    expect(patchLineCount(fix)).toBe(2);
  });

  it('returns 0 if patch removes lines', () => {
    const fix: FixProposal = {
      uri: 'u',
      oldText: 'a\nb\nc',
      newText: 'a',
    };
    expect(patchLineCount(fix)).toBe(0);
  });
});

describe('decideRisk', () => {
  it('low if source is auto and patch under threshold', () => {
    expect(decideRisk(diag('eslint'), { uri: 'u', oldText: 'a', newText: 'b' }, ['eslint'], 3)).toBe('low');
  });

  it('high if source is auto but patch exceeds threshold', () => {
    const big: FixProposal = {
      uri: 'u',
      oldText: 'a',
      newText: '1\n2\n3\n4\n5',
    };
    expect(decideRisk(diag('eslint'), big, ['eslint'], 3)).toBe('high');
  });

  it('high if source is not auto regardless of size', () => {
    expect(decideRisk(diag('tsc'), { uri: 'u', oldText: 'a', newText: 'b' }, ['eslint'], 3)).toBe('high');
  });
});
