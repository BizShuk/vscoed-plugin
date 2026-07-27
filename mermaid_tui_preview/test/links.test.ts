import { describe, expect, it } from 'vitest';
import type { DetectedMermaidDiagram } from '../src/detector';
import {
  resolveTerminalLink,
  selectTerminalLinkSource,
} from '../src/links';

const diagram: DetectedMermaidDiagram = {
  source: 'flowchart TD\nA --> B',
  directive: 'flowchart',
  marker: 'mermaid',
};

const secondDiagram: DetectedMermaidDiagram = {
  source: 'flowchart TD\nX --> Y',
  directive: 'flowchart',
  marker: 'mermaid',
};

const lookup = {
  marked: () => [diagram],
  matchingDirective: (directive: string, header: string) =>
    directive.toLowerCase() === 'flowchart' && header === 'flowchart TD'
      ? [diagram]
      : [],
};

describe('resolveTerminalLink', () => {
  it('links the Claude TUI mermaid marker', () => {
    expect(resolveTerminalLink('⏺ mermaid', lookup)).toEqual({
      startIndex: 2,
      length: 7,
      sources: [diagram.source],
    });
  });

  it('matches a Codex diagram by its complete directive header', () => {
    expect(resolveTerminalLink('• flowchart TD', lookup)).toEqual({
      startIndex: 2,
      length: 9,
      sources: [diagram.source],
    });
  });

  it('keeps all candidates when identical headers are ambiguous', () => {
    expect(
      resolveTerminalLink('• flowchart TD', {
        marked: () => [],
        matchingDirective: () => [diagram, secondDiagram],
      }),
    ).toEqual({
      startIndex: 2,
      length: 9,
      sources: [diagram.source, secondDiagram.source],
    });
  });

  it('does not link a directive embedded in ordinary prose', () => {
    expect(
      resolveTerminalLink('The flowchart TD syntax is useful.', lookup),
    ).toBeUndefined();
  });

  it('does not link a marker before a diagram has been captured', () => {
    expect(
      resolveTerminalLink('mermaid', {
        marked: () => [],
        matchingDirective: () => [],
      }),
    ).toBeUndefined();
  });
});

describe('selectTerminalLinkSource', () => {
  it('selects the only matching source without prompting', async () => {
    let prompted = false;

    const selected = await selectTerminalLinkSource(
      [diagram.source],
      async () => {
        prompted = true;
        return undefined;
      },
    );

    expect(selected).toBe(diagram.source);
    expect(prompted).toBe(false);
  });

  it('prompts when identical terminal lines match multiple diagrams', async () => {
    const selected = await selectTerminalLinkSource(
      [diagram.source, secondDiagram.source],
      async (sources) => sources[0],
    );

    expect(selected).toBe(diagram.source);
  });
});
