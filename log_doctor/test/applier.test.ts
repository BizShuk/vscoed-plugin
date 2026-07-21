vi.mock('vscode', () => ({
  Uri: { parse: (s: string) => ({ fsPath: s.replace('file://', ''), toString: () => s, scheme: 'file' }) },
  Range: class {
    constructor(public start: any, public end: any) {}
  },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  WorkspaceEdit: class {
    private map = new Map<string, any[]>();
    replace(uri: any, _range: any, newText: string) {
      const arr = this.map.get(uri.toString()) ?? [];
      arr.push({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText });
      this.map.set(uri.toString(), arr);
    }
    get(uri: any) { return this.map.get(uri.toString()); }
    get size() { return this.map.size; }
  },
}));

import { describe, it, expect, vi } from 'vitest';
import { buildWorkspaceEdit, needsConfirmation, applyOrConfirm } from '../src/applier';
import { FixProposal, DiagnosticInfo } from '../src/types';

const d: DiagnosticInfo = {
  uri: 'file:///proj/a.ts',
  source: 'eslint',
  message: 'x',
  severity: 'warning',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
};

const fix: FixProposal = {
  uri: 'file:///proj/a.ts',
  oldText: 'const foo = 1;',
  newText: '',
  rationale: 'unused',
};

describe('buildWorkspaceEdit', () => {
  it('creates a single TextEdit replacing oldText with newText', () => {
    const edit = buildWorkspaceEdit(fix, 'const foo = 1;\nconst bar = 2;');
    expect(edit.size).toBe(1);
    const fileEdit = edit.get(vscodeUri('file:///proj/a.ts'));
    expect(fileEdit).toBeDefined();
    const first = fileEdit![0];
    expect(first.range.start.line).toBe(0);
    expect(first.range.start.character).toBe(0);
    expect(first.newText).toBe('');
  });

  it('throws when oldText not found in file', () => {
    expect(() => buildWorkspaceEdit(fix, 'totally different content')).toThrow(/oldText/);
  });
});

describe('needsConfirmation', () => {
  it('returns true for high-risk source', () => {
    expect(needsConfirmation({ ...d, source: 'tsc' }, fix, ['eslint'], 3)).toBe(true);
  });

  it('returns false for low-risk small patch', () => {
    expect(needsConfirmation({ ...d, source: 'eslint' }, fix, ['eslint'], 3)).toBe(false);
  });
});

describe('applyOrConfirm', () => {
  it('applies directly when low risk', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('apply');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix: { ...fix, newText: '' },
      diagnostic: { ...d, source: 'eslint' },
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(result.applied).toBe(true);
    expect(apply).toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('shows diff and asks when high risk', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('apply');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix,
      diagnostic: { ...d, source: 'tsc' },
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(show).toHaveBeenCalled();
    expect(result.applied).toBe(true);
  });

  it('does not apply when user declines', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('reject');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix,
      diagnostic: { ...d, source: 'tsc' },
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

function vscodeUri(s: string): any {
  return { fsPath: s.replace('file://', ''), toString: () => s, scheme: 'file' };
}
