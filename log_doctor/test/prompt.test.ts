import { describe, it, expect } from 'vitest';
import { buildFixPrompt, parseFixResponse } from '../src/prompt';
import { RepresentativeDiagnostic } from '../src/types';

const rep: RepresentativeDiagnostic = {
  info: {
    uri: 'file:///proj/src/a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used.",
    severity: 'warning',
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } },
  },
  groupSize: 1,
  groupUris: [],
};

const fileText = [
  'import x from "y";',                // line 0
  '',                                   // line 1
  'export function f() {',              // line 2
  '  const foo = 1;',                   // line 3
  '  return x;',                        // line 4
  '}',                                  // line 5
].join('\n');

describe('buildFixPrompt', () => {
  it('contains the file path, snippet around the diagnostic, and instructions', () => {
    const { system, user } = buildFixPrompt({
      diagnostic: rep,
      fileUri: 'file:///proj/src/a.ts',
      fileText,
    });
    expect(system).toMatch(/JSON/i);
    expect(system).toMatch(/oldText/);
    expect(user).toContain('file:///proj/src/a.ts');
    expect(user).toContain("Variable 'foo' is defined but never used");
    expect(user).toContain('const foo = 1;');
  });

  it('includes context lines around the diagnostic range', () => {
    const { user } = buildFixPrompt({
      diagnostic: rep,
      fileUri: 'file:///proj/src/a.ts',
      fileText,
      contextLines: 2,
    });
    // 應該至少包含前後 2 行
    expect(user).toContain('export function f() {');
    expect(user).toContain('return x;');
  });
});

describe('parseFixResponse', () => {
  it('parses a plain JSON object', () => {
    const raw = JSON.stringify({
      fixes: [
        { uri: 'file:///a.ts', oldText: 'a', newText: 'b', rationale: 'fix' },
      ],
    });
    const { fixes, error } = parseFixResponse(raw);
    expect(error).toBeUndefined();
    expect(fixes).toEqual([
      { uri: 'file:///a.ts', oldText: 'a', newText: 'b', rationale: 'fix' },
    ]);
  });

  it('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n{"fixes":[]}\n```';
    const { fixes, error } = parseFixResponse(raw);
    expect(error).toBeUndefined();
    expect(fixes).toEqual([]);
  });

  it('returns error for non-JSON content', () => {
    const { fixes, error } = parseFixResponse('not json');
    expect(fixes).toEqual([]);
    expect(error).toBeTruthy();
  });

  it('returns error when fixes is missing', () => {
    const { fixes, error } = parseFixResponse(JSON.stringify({}));
    expect(fixes).toEqual([]);
    expect(error).toMatch(/fixes/);
  });
});
