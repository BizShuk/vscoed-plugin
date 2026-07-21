import { describe, it, expect, vi } from 'vitest';
import { PersistentQueue } from '../src/queue';
import { QueueItem, RepresentativeDiagnostic } from '../src/types';

function memento(): { get: any; update: any; keys: any } {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn((k: string) => data.get(k)),
    update: vi.fn((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    keys: () => Array.from(data.keys()),
  };
}

function item(id: string, priority: number, uri: string): QueueItem {
  const rep: RepresentativeDiagnostic = {
    info: {
      uri,
      source: 'eslint',
      message: id,
      severity: 'warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
    groupSize: 1,
    groupUris: [],
  };
  return {
    id,
    diagnostic: rep,
    priority,
    attempts: 0,
    status: 'pending',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('PersistentQueue', () => {
  it('adds and lists items sorted by priority', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 2, 'file:///a'));
    await q.add(item('b', 0, 'file:///b'));
    await q.add(item('c', 1, 'file:///c'));
    const list = q.list();
    expect(list.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('removes an item by id', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.add(item('b', 1, 'file:///b'));
    await q.remove('a');
    expect(q.list().map((i) => i.id)).toEqual(['b']);
  });

  it('updates item fields by id', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.update('a', { status: 'in_flight', attempts: 1 });
    const got = q.list()[0];
    expect(got.status).toBe('in_flight');
    expect(got.attempts).toBe(1);
  });

  it('picks the next pending item with lowest priority number', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 5, 'file:///a'));
    await q.add(item('b', 0, 'file:///b'));
    await q.add(item('c', 3, 'file:///c'));
    expect(q.peek()?.id).toBe('b');
  });

  it('persists across instances via the same memento', async () => {
    const m = memento();
    const q1 = new PersistentQueue(m as any);
    await q1.add(item('a', 0, 'file:///a'));
    const q2 = new PersistentQueue(m as any);
    expect(q2.list()).toHaveLength(1);
  });

  it('ignores duplicates when adding the same id twice', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.add(item('a', 0, 'file:///a'));
    expect(q.list()).toHaveLength(1);
  });
});
