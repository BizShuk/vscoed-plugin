import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/scheduler';
import type { Memento } from 'vscode';

function memento(): Memento {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn((k: string) => data.get(k)),
    update: vi.fn((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    keys: () => Array.from(data.keys()),
  } as any;
}

describe('Scheduler.canRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when never applied', () => {
    const s = new Scheduler(memento(), 30);
    expect(s.canRun()).toBe(true);
  });

  it('returns false within cooldown window', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(10 * 60 * 1000); // 10 min later
    expect(s.canRun()).toBe(false);
  });

  it('returns true after cooldown window', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min later
    expect(s.canRun()).toBe(true);
  });

  it('persists timestamp across instances', () => {
    const m = memento();
    const s1 = new Scheduler(m, 30);
    s1.markApplied();
    const s2 = new Scheduler(m, 30);
    expect(s2.canRun()).toBe(false);
  });

  it('treats cooldownMinutes = 0 as always runnable', () => {
    const m = memento();
    const s = new Scheduler(m, 0);
    s.markApplied();
    expect(s.canRun()).toBe(true);
  });

  it('msUntilNextRun returns the remaining wait time', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(s.msUntilNextRun()).toBe(25 * 60 * 1000);
  });
});
