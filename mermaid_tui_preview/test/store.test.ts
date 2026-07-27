import { describe, expect, it } from 'vitest';
import type { DetectedMermaidDiagram } from '../src/detector';
import { MermaidDiagramStore } from '../src/store';

function diagram(
  source: string,
  directive = 'flowchart',
  marker?: string,
): DetectedMermaidDiagram {
  return { source, directive, marker };
}

describe('MermaidDiagramStore', () => {
  it('keeps distinct diagram ids side-by-side per terminal', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const flowchartTb = diagram('flowchart TD\nA --> B');
    const sequence = diagram(
      'sequenceDiagram\nA->>B: Hi',
      'sequenceDiagram',
    );

    store.record(terminal, [flowchartTb]);
    store.record(terminal, [sequence]);

    expect(store.entries(terminal)).toEqual([flowchartTb, sequence]);
  });

  it('overwrites only the slot whose id matches', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const firstTb = diagram('flowchart TD\nA --> B');
    const sequence = diagram(
      'sequenceDiagram\nA->>B: Hi',
      'sequenceDiagram',
    );

    store.record(terminal, [firstTb]);
    store.record(terminal, [sequence]);
    store.record(terminal, [diagram('flowchart TD\nA --> B\nB --> C')]);

    const remaining = store.entries(terminal);
    expect(remaining).toHaveLength(2);
    expect(
      remaining.find((item) => item.directive === 'flowchart')?.source,
    ).toBe('flowchart TD\nA --> B\nB --> C');
    expect(
      remaining.find((item) => item.directive === 'sequenceDiagram')
        ?.source,
    ).toBe('sequenceDiagram\nA->>B: Hi');
  });

  it('falls back to the directive name when no directive header is found', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();

    store.record(terminal, [diagram('plain text without directive')]);

    expect(store.entries(terminal)).toEqual([
      diagram('plain text without directive'),
    ]);
  });

  it('keeps terminals independent of each other', () => {
    const termA = {};
    const termB = {};
    const store = new MermaidDiagramStore<object>();

    store.record(termA, [diagram('flowchart TD\nA --> B')]);
    store.record(termB, [
      diagram('sequenceDiagram\nX->>Y', 'sequenceDiagram'),
    ]);

    expect(store.entries(termA)).toEqual([diagram('flowchart TD\nA --> B')]);
    expect(store.entries(termB)).toEqual([
      diagram('sequenceDiagram\nX->>Y', 'sequenceDiagram'),
    ]);
  });

  it('returns the diagram captured from a Mermaid marker', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const marked: DetectedMermaidDiagram = {
      source: 'flowchart TD\nA --> B',
      directive: 'flowchart',
      marker: 'mermaid',
    };
    const direct = diagram('sequenceDiagram\nA->>B: Hi', 'sequenceDiagram');

    store.record(terminal, [marked, direct]);

    expect(store.marked(terminal)).toEqual([marked]);
  });

  it('looks up the id-targeted diagram via matchingDirective', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    store.record(terminal, [diagram('flowchart TD\nA --> B')]);

    expect(
      store.matchingDirective(terminal, 'flowchart', 'flowchart TD'),
    ).toEqual([diagram('flowchart TD\nA --> B')]);
    expect(
      store.matchingDirective(terminal, 'flowchart', 'flowchart LR'),
    ).toEqual([]);
    expect(
      store.matchingDirective(terminal, 'sequenceDiagram', 'sequenceDiagram'),
    ).toEqual([]);
  });

  it('clears cached diagrams when a terminal closes', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    store.record(terminal, [diagram('flowchart TD')]);

    store.clear(terminal);

    expect(store.latest(terminal)).toBeUndefined();
  });
});
