import { describe, expect, it } from 'vitest';
import type { DetectedMermaidDiagram } from '../src/detector';
import { resolveTerminalLink } from '../src/links';

const diagram: DetectedMermaidDiagram = {
  source: 'flowchart TD\nA --> B',
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
