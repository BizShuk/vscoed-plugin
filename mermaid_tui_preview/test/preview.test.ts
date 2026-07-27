import { describe, expect, it } from 'vitest';
import {
  normalizeMermaidSource,
  openMermaidPreview,
  type MermaidPreviewPort,
} from '../src/preview';

function createPort(): {
  events: string[];
  port: MermaidPreviewPort;
} {
  const events: string[] = [];
  return {
    events,
    port: {
      showPreview: async (source) => {
        events.push(`preview:${source}`);
      },
    },
  };
}

describe('openMermaidPreview', () => {
  it('opens normalized source in the interactive preview', async () => {
    const { events, port } = createPort();

    await openMermaidPreview(' flowchart TD\nA --> B \n', port);

    expect(events).toEqual(['preview:flowchart TD\nA --> B\n']);
  });

  it('collapses <br/> tags to a single space before rendering', async () => {
    const { events, port } = createPort();

    await openMermaidPreview(
      'flowchart LR\nA["資料庫<br/>(Database)"] --> B\n',
      port,
    );

    expect(events).toEqual([
      'preview:flowchart LR\nA["資料庫 (Database)"] --> B\n',
    ]);
  });

  it('handles multiple <br> variants in one source', () => {
    expect(
      normalizeMermaidSource(
        '["<br>"]\n["<br />"]\n["<br/>"]\n["<BR/>"]\n["plain"]',
      ),
    ).toBe('[" "]\n[" "]\n[" "]\n[" "]\n["plain"]');
  });
});
