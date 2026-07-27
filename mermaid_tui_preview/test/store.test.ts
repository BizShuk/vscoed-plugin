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
  it('keeps distinct diagram types side-by-side per terminal', () => {
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

  it('replaces an earlier partial render without removing other diagrams', () => {
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

  it('keeps different diagrams that use the same directive header', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram('flowchart LR\nA --> B');
    const second = diagram('flowchart LR\nX --> Y');

    store.record(terminal, [first]);
    store.record(terminal, [second]);

    expect(store.entries(terminal)).toEqual([first, second]);
    expect(
      store.matchingDirective(terminal, 'flowchart', 'flowchart LR'),
    ).toEqual([first, second]);
  });

  it('moves the most recently updated diagram to the end', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram('flowchart LR\nA --> B');
    const sequence = diagram(
      'sequenceDiagram\nA->>B: Hi',
      'sequenceDiagram',
    );
    const updated = diagram('flowchart LR\nA --> B\nB --> C');

    store.record(terminal, [first]);
    store.record(terminal, [sequence]);
    store.record(terminal, [updated]);

    expect(store.entries(terminal)).toEqual([sequence, updated]);
    expect(store.latest(terminal)).toEqual(updated);
  });

  it('keeps only the latest twenty diagrams per terminal', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const diagrams = Array.from({ length: 21 }, (_, index) =>
      diagram(`flowchart TD diagram-${index}\nA${index} --> B${index}`),
    );

    for (const item of diagrams) {
      store.record(terminal, [item]);
    }

    expect(store.entries(terminal)).toEqual(diagrams.slice(1));
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

describe('terminal link resolution', () => {
  it('links the Claude marker directly to the latest marked diagram', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram(
      'flowchart TD\nA --> B',
      'flowchart',
      'mermaid',
    );
    const second = diagram(
      'sequenceDiagram\nA->>B: Hi',
      'sequenceDiagram',
      'mermaid',
    );
    store.record(terminal, [first, second]);

    expect(
      store.resolveTerminalLink(terminal, '⏺ mermaid'),
    ).toEqual({
      startIndex: 2,
      length: 7,
      source: second.source,
    });
  });

  it('links a directive directly to the latest diagram with that header', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    const first = diagram('flowchart TD\nA --> B');
    const second = diagram('flowchart TD\nX --> Y');
    store.record(terminal, [first, second]);

    expect(
      store.resolveTerminalLink(terminal, '• flowchart TD'),
    ).toEqual({
      startIndex: 2,
      length: 9,
      source: second.source,
    });
  });

  it('does not link ordinary prose or uncaptured diagrams', () => {
    const terminal = {};
    const store = new MermaidDiagramStore<object>();
    store.record(terminal, [diagram('flowchart TD\nA --> B')]);

    expect(
      store.resolveTerminalLink(
        terminal,
        'The flowchart TD syntax is useful.',
      ),
    ).toBeUndefined();
    expect(
      store.resolveTerminalLink({}, '• flowchart TD'),
    ).toBeUndefined();
  });
});
