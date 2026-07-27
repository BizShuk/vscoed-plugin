import { describe, expect, it } from 'vitest';
import {
  detectMermaidDiagrams,
  findMermaidDirectiveInLine,
} from '../src/detector';

describe('detectMermaidDiagrams', () => {
  it('extracts the marker block rendered by Claude TUI', () => {
    const diagrams = detectMermaidDiagrams([
      '⏺ mermaid',
      '  flowchart TD',
      '      A[Start] --> B[Done]',
      '',
      '✻ Sautéed for 2s',
    ]);

    expect(diagrams).toEqual([
      {
        source: 'flowchart TD\n    A[Start] --> B[Done]',
        directive: 'flowchart',
        marker: 'mermaid',
      },
    ]);
  });

  it('extracts the directive block rendered by Codex TUI', () => {
    const diagrams = detectMermaidDiagrams([
      '• flowchart TD',
      '      A[Start] --> B[Done]',
      '',
      '› Improve documentation in @filename',
    ]);

    expect(diagrams).toEqual([
      {
        source: 'flowchart TD\nA[Start] --> B[Done]',
        directive: 'flowchart',
        marker: undefined,
      },
    ]);
  });

  it('uses Codex renderer padding rather than the first semantic indent', () => {
    const diagrams = detectMermaidDiagrams([
      '• flowchart TD',
      '          subgraph Group',
      '              A --> B',
      '      end',
      '',
      '› prompt',
    ]);

    expect(diagrams[0]?.source).toBe(
      'flowchart TD\n    subgraph Group\n        A --> B\nend',
    );
  });

  it('extracts a literal fenced Mermaid block', () => {
    const diagrams = detectMermaidDiagrams([
      '```mermaid',
      'sequenceDiagram',
      '    Alice->>Bob: Hello',
      '```',
      'ordinary prose',
    ]);

    expect(diagrams).toEqual([
      {
        source: 'sequenceDiagram\n    Alice->>Bob: Hello',
        directive: 'sequenceDiagram',
        marker: 'mermaid',
      },
    ]);
  });

  it('preserves an internal blank line in an indented marker block', () => {
    const diagrams = detectMermaidDiagrams([
      'mermaid',
      '  flowchart TD',
      '      A --> B',
      '',
      '      B --> C',
      '',
      '❯ prompt',
    ]);

    expect(diagrams[0]?.source).toBe(
      'flowchart TD\n    A --> B\n\n    B --> C',
    );
  });

  it('separates consecutive Claude blocks and excludes prose between them', () => {
    const diagrams = detectMermaidDiagrams([
      '⏺ mermaid',
      '  flowchart TD',
      '      A1[簡單版] --> A2[完成]',
      '',
      '  🟦 複雜版 (Complex) — 更多控制',
      '',
      '⏺ mermaid',
      '  flowchart LR',
      '      B1[複雜版] --> B2[完成]',
    ]);

    expect(diagrams).toEqual([
      {
        source: 'flowchart TD\n    A1[簡單版] --> A2[完成]',
        directive: 'flowchart',
        marker: 'mermaid',
      },
      {
        source: 'flowchart LR\n    B1[複雜版] --> B2[完成]',
        directive: 'flowchart',
        marker: 'mermaid',
      },
    ]);
  });

  it('separates consecutive Codex blocks with the same directive', () => {
    const diagrams = detectMermaidDiagrams([
      '• flowchart TD',
      '      A1[Simple] --> A2[Done]',
      '• flowchart LR',
      '      B1[Complex] --> B2[Done]',
    ]);

    expect(diagrams).toEqual([
      {
        source: 'flowchart TD\nA1[Simple] --> A2[Done]',
        directive: 'flowchart',
        marker: undefined,
      },
      {
        source: 'flowchart LR\nB1[Complex] --> B2[Done]',
        directive: 'flowchart',
        marker: undefined,
      },
    ]);
  });

  it('waits for source after a marker-only partial render', () => {
    expect(detectMermaidDiagrams(['⏺ mermaid'])).toEqual([]);
  });

  it('does not treat prose mentioning a directive as a diagram', () => {
    expect(
      detectMermaidDiagrams([
        'The flowchart TD syntax is useful.',
        'This is ordinary prose.',
      ]),
    ).toEqual([]);
  });
});

describe('findMermaidDirectiveInLine', () => {
  it('returns the visible range of a Codex diagram directive', () => {
    expect(findMermaidDirectiveInLine('• flowchart TD')).toEqual({
      directive: 'flowchart',
      startIndex: 2,
      length: 9,
    });
  });

  it('recognizes a state diagram variant', () => {
    expect(findMermaidDirectiveInLine('  stateDiagram-v2')).toEqual({
      directive: 'stateDiagram-v2',
      startIndex: 2,
      length: 15,
    });
  });
});
