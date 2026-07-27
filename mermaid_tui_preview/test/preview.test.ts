import { describe, expect, it } from 'vitest';
import {
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
});
