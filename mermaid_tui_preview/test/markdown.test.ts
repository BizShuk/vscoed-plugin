import { describe, expect, it } from 'vitest';
import {
  findMarkdownMermaidBlocks,
  selectMarkdownMermaidBlock,
} from '../src/markdown';

describe('findMarkdownMermaidBlocks', () => {
  it('extracts a fenced mermaid block and its opening marker range', () => {
    const blocks = findMarkdownMermaidBlocks([
      '# Diagram',
      '',
      '  ```mermaid',
      '    flowchart TD',
      '      A[Start] --> B[Done]',
      '  ```',
    ]);

    expect(blocks).toEqual([
      {
        source: 'flowchart TD\n  A[Start] --> B[Done]',
        openingLine: 2,
        openingStart: 5,
        openingEnd: 12,
        closingLine: 5,
      },
    ]);
  });

  it('supports tilde fences and ignores other fenced languages', () => {
    const blocks = findMarkdownMermaidBlocks([
      '```typescript',
      'const ignored = true;',
      '```',
      '~~~ mermaid',
      'sequenceDiagram',
      '  A->>B: Hello',
      '~~~',
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.source).toBe('sequenceDiagram\n  A->>B: Hello');
  });

  it('treats an unclosed mermaid fence as continuing to end of file', () => {
    expect(
      findMarkdownMermaidBlocks([
        '```mermaid',
        'flowchart TD',
        'A --> B',
      ]),
    ).toEqual([
      {
        source: 'flowchart TD\nA --> B',
        openingLine: 0,
        openingStart: 3,
        openingEnd: 10,
        closingLine: 2,
      },
    ]);
  });
});

describe('selectMarkdownMermaidBlock', () => {
  it('selects the block containing the active editor line', () => {
    const blocks = findMarkdownMermaidBlocks([
      '```mermaid',
      'flowchart TD',
      'A --> B',
      '```',
      '',
      '```mermaid',
      'sequenceDiagram',
      'A->>B: Hello',
      '```',
    ]);

    expect(selectMarkdownMermaidBlock(blocks, 7)?.source).toBe(
      'sequenceDiagram\nA->>B: Hello',
    );
    expect(selectMarkdownMermaidBlock(blocks, 4)).toBeUndefined();
  });
});
