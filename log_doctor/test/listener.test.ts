import { describe, it, expect } from 'vitest';
import { fingerprint, matchRule, loadRules, newDedupState, applyDedup, formatLogLine } from '../src/listener';
import type { ListenerRule } from '../src/types';

describe('fingerprint', () => {
  it('returns same hash for same ruleId + same text', () => {
    const rule = { id: 'r1', channel: 'c', pattern: 'x' };
    expect(fingerprint(rule, 'hello')).toBe(fingerprint(rule, 'hello'));
  });

  it('treats trailing whitespace as same hash', () => {
    const rule = { id: 'r1', channel: 'c', pattern: 'x' };
    expect(fingerprint(rule, 'hello')).toBe(fingerprint(rule, 'hello   '));
  });

  it('returns different hash for different ruleId + same text', () => {
    const a = { id: 'r1', channel: 'c', pattern: 'x' };
    const b = { id: 'r2', channel: 'c', pattern: 'x' };
    expect(fingerprint(a, 'hello')).not.toBe(fingerprint(b, 'hello'));
  });
});

describe('matchRule', () => {
  const withRe = (id: string, channel: string, pattern: string) => ({
    id,
    channel,
    pattern,
    _re: new RegExp(pattern),
  });

  it('matches exact channel', () => {
    const rule = withRe('r1', 'ESLint', 'warning');
    expect(matchRule(rule, { channel: 'ESLint', text: 'some warning here' })).toBe(true);
  });

  it('matches channel glob ESLint* against "ESLint Server"', () => {
    const rule = withRe('r1', 'ESLint*', 'warning');
    expect(matchRule(rule, { channel: 'ESLint Server', text: 'a warning' })).toBe(true);
  });

  it('does not match channel glob ESLint* against "Jest Output"', () => {
    const rule = withRe('r1', 'ESLint*', 'warning');
    expect(matchRule(rule, { channel: 'Jest Output', text: 'a warning' })).toBe(false);
  });

  it('channel glob is case-sensitive: ESLint* does not match "eslint server"', () => {
    const rule = withRe('r1', 'ESLint*', 'warning');
    expect(matchRule(rule, { channel: 'eslint server', text: 'a warning' })).toBe(false);
  });

  it('matches regex ^error against "error TS1234: ..."', () => {
    const rule = withRe('r1', 'TypeScript', '^error TS\\d+:');
    expect(matchRule(rule, { channel: 'TypeScript', text: 'error TS1234: bad type' })).toBe(true);
  });

  it('regex (?i) enables case-insensitive matching', () => {
    const rule = withRe('r1', 'X', '[Ww][Aa][Rr][Nn][Ii][Nn][Gg]');
    expect(matchRule(rule, { channel: 'X', text: 'WARNING: foo' })).toBe(true);
  });
});

describe('loadRules', () => {
  it('accepts valid rules and defaults label = id when missing', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X', pattern: 'foo' },
      { id: 'r2', channel: 'Y', pattern: 'bar', label: 'Custom' },
    ]);
    expect(warnings).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[0].label).toBe('r1');
    expect(rules[1].label).toBe('Custom');
    expect(rules[0].cooldownMs).toBe(300000);
  });

  it('skips rules missing id, channel, or pattern', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X' /* missing pattern */ } as never,
      { id: 'r2', pattern: 'foo' } as never,
      { channel: 'X', pattern: 'foo' } as never,
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings).toHaveLength(3);
  });

  it('skips rules with invalid regex and includes raw pattern in warning', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X', pattern: '[unclosed' },
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings[0]).toContain('[unclosed');
  });

  it('keeps first occurrence when id duplicates', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'A', pattern: 'foo' },
      { id: 'r1', channel: 'B', pattern: 'bar' },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].channel).toBe('A');
    expect(warnings[0]).toMatch(/duplicate/i);
  });

  it('forces cooldownMs to 300000 when invalid', () => {
    const { rules } = loadRules([
      { id: 'r1', channel: 'X', pattern: 'foo', cooldownMs: -1 },
      { id: 'r2', channel: 'Y', pattern: 'bar', cooldownMs: 'foo' as never },
    ]);
    expect(rules[0].cooldownMs).toBe(300000);
    expect(rules[1].cooldownMs).toBe(300000);
  });

  it('skips rules with id containing illegal characters', () => {
    const { rules, warnings } = loadRules([
      { id: 'has space', channel: 'X', pattern: 'foo' },
      { id: 'has.dot', channel: 'Y', pattern: 'bar' },
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  });
});

describe('applyDedup', () => {
  const rule = () => ({
    id: 'r1', channel: 'X', pattern: 'foo', label: 'R1', cooldownMs: 300000,
    _re: /foo/,
  } as ListenerRule & { _re: RegExp });

  it('first occurrence returns count=1 and stores entry', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    const { line, evicted } = applyDedup(state, rule(), 'hello', t0);
    expect(line.count).toBe(1);
    expect(line.text).toBe('hello');
    expect(evicted).toBe(0);
    expect(state.entries.size).toBe(1);
  });

  it('second occurrence within cooldown returns count=2 with same sample text', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    const { line } = applyDedup(state, rule(), 'hello', t0 + 60_000);
    expect(line.count).toBe(2);
    expect(line.text).toBe('hello');
  });

  it('after cooldown elapses, treats as new event with count=1', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    const { line } = applyDedup(state, rule(), 'hello', t0 + 400_000); // > 300000 cooldown
    expect(line.count).toBe(1);
    expect(line.text).toBe('hello');
  });

  it('different fingerprints tracked independently', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    applyDedup(state, rule(), 'world', t0);
    const a = applyDedup(state, rule(), 'hello', t0 + 10_000);
    const b = applyDedup(state, rule(), 'world', t0 + 10_000);
    expect(a.line.count).toBe(2);
    expect(b.line.count).toBe(2);
  });

  it('evicts stale entries when entries.size >= 10000', () => {
    const state = newDedupState();
    // 灌 10000 筆,時間都設成 t0
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10000; i++) {
      applyDedup(state, rule(), `msg-${i}`, t0);
    }
    expect(state.entries.size).toBe(10000);
    // 第 10001 筆,時間 +400s,觸發 evict
    const { evicted } = applyDedup(state, rule(), 'msg-new', t0 + 400_000);
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(state.entries.size).toBeLessThanOrEqual(10000);
  });
});

describe('formatLogLine', () => {
  it('count=1 omits ×N suffix', () => {
    const out = formatLogLine({
      channel: 'ESLint', label: 'ESLint Warning', text: 'warning foo', count: 1,
    });
    expect(out).not.toMatch(/×/);
    expect(out).toContain('ESLint Warning@ESLint: warning foo');
  });

  it('count=5 includes (×5)', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 5,
    });
    expect(out).toMatch(/\(×5\)$/);
  });

  it('includes [error] severity prefix when provided', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1, severity: 'error',
    });
    expect(out).toMatch(/\[error\]/);
  });

  it('omits severity prefix when undefined', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1,
    });
    expect(out).not.toMatch(/\[(info|warn|error)\]/);
  });

  it('starts with ISO timestamp', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1,
    });
    expect(out).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

