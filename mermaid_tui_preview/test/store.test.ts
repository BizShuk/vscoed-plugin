import { describe, expect, it } from 'vitest';
import type { DetectedMermaidDiagram } from '../src/detector';
import { MermaidDiagramStore } from '../src/store';

function diagram(
  source: string,
  directive = 'flowchart',
): DetectedMermaidDiagram {
  return { source, directive, marker: undefined };
}

describe('MermaidDiagramStore', () => {
  it('replaces a partial render with the completed diagram', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();

    store.record(terminal, [diagram('flowchart TD')]);
    store.record(terminal, [diagram('flowchart TD\nA --> B')]);

    expect(store.entries(terminal)).toEqual([
      diagram('flowchart TD\nA --> B'),
    ]);
  });

  it('keeps prefix-related diagrams that coexist in one screen scan', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const simple = diagram('flowchart TD\nA --> B');
    const complex = diagram('flowchart TD\nA --> B\nB --> C');

    store.record(terminal, [simple, complex]);

    expect(store.entries(terminal)).toEqual([simple, complex]);
  });

  it('deduplicates exact screen rescans and keeps the item most recent', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram('flowchart TD\nA --> B');
    const second = diagram('sequenceDiagram\nA->>B: Hi', 'sequenceDiagram');

    store.record(terminal, [first, second]);
    store.record(terminal, [first]);

    expect(store.entries(terminal)).toEqual([second, first]);
    expect(store.latest(terminal)).toEqual(first);
  });

  it('keeps at most the configured number of diagrams per terminal', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>(2);

    store.record(terminal, [
      diagram('one', 'one'),
      diagram('two', 'two'),
      diagram('three', 'three'),
    ]);

    expect(store.entries(terminal).map((item) => item.source)).toEqual([
      'two',
      'three',
    ]);
    expect(store.matchingDirective(terminal, 'one', 'one')).toEqual([]);
  });

  it('returns every diagram whose complete directive header matches', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram('flowchart TD\nA --> B');
    const second = diagram('flowchart LR\nX --> Y');
    const third = diagram('flowchart TD\nC --> D');

    store.record(terminal, [first, second, third]);

    expect(
      store.matchingDirective(terminal, 'flowchart', 'flowchart TD'),
    ).toEqual([first, third]);
  });

  it('returns every diagram captured from a Mermaid marker', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const marked = {
      ...diagram('flowchart TD\nA --> B'),
      marker: 'mermaid',
    };
    const direct = diagram('sequenceDiagram\nA->>B: Hi', 'sequenceDiagram');

    store.record(terminal, [marked, direct]);

    expect(store.marked(terminal)).toEqual([marked]);
  });

  it('clears cached diagrams when a terminal closes', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    store.record(terminal, [diagram('flowchart TD')]);

    store.clear(terminal);

    expect(store.latest(terminal)).toBeUndefined();
  });
});
