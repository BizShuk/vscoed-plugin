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
  try {
    for await (const data of stream) {
      for (const frame of splitAtFrameBoundaries(data)) {
        const lines = await screen.write(frame);
        const diagrams = detectMermaidDiagrams(lines);
        if (diagrams.length > 0) {
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
