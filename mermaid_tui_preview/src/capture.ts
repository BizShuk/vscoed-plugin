import {
  detectMermaidDiagrams,
  type DetectedMermaidDiagram,
} from './detector';

export interface TerminalScreenLike {
  write(data: string): Promise<readonly string[]>;
  dispose(): void;
}

export async function captureMermaidStream(
  stream: AsyncIterable<string>,
  screen: TerminalScreenLike,
  onDetected: (diagrams: readonly DetectedMermaidDiagram[]) => void,
): Promise<void> {
  let frameTotal = 0;
  try {
    for await (const data of stream) {
      // eslint-disable-next-line no-console
      console.log('[MTUI] frame bytes=', data.length);
      for (const frame of splitAtFrameBoundaries(data)) {
        frameTotal += 1;
        // eslint-disable-next-line no-console
        console.log(
          '[MTUI] split frames=',
          frameTotal,
          'preview=',
          JSON.stringify(frame).slice(0, 120),
        );
        const lines = await screen.write(frame);
        const diagrams = detectMermaidDiagrams(lines);
        if (diagrams.length > 0) {
          // eslint-disable-next-line no-console
          console.log('[MTUI] detected diagrams=', diagrams.length);
          onDetected(diagrams);
        }
      }
    }
  } finally {
    screen.dispose();
  }
}

function splitAtFrameBoundaries(data: string): readonly string[] {
  return data
    .split(/(?<=[\r\n])|(?=\u001b\[(?:\d*;\d*)?[Hf])/u)
    .filter((frame) => frame.length > 0);
}
