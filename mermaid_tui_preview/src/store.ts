import type { DetectedMermaidDiagram } from './detector';
import { findMermaidDirectiveInLine } from './detector';

export class MermaidDiagramStore<K extends object> {
  private readonly diagrams = new WeakMap<K, DetectedMermaidDiagram[]>();

  constructor(private readonly maximumPerKey = 20) {}

  record(key: K, detected: readonly DetectedMermaidDiagram[]): void {
    const current = [...(this.diagrams.get(key) ?? [])];
    const simultaneouslyDetectedSources = new Set(
      detected.map((diagram) => diagram.source),
    );
    for (const diagram of detected) {
      const exactIndex = current.findIndex(
        (item) => item.source === diagram.source,
      );
      if (exactIndex >= 0) {
        current.splice(exactIndex, 1);
        current.push(diagram);
        continue;
      }

      const progressiveIndex = current.findIndex(
        (item) =>
          !simultaneouslyDetectedSources.has(item.source) &&
          item.directive.toLowerCase() === diagram.directive.toLowerCase() &&
          (item.source.startsWith(diagram.source) ||
            diagram.source.startsWith(item.source)),
      );
      if (progressiveIndex >= 0) {
        current.splice(progressiveIndex, 1);
      }
      current.push(diagram);
    }
    this.diagrams.set(key, current.slice(-this.maximumPerKey));
  }

  entries(key: K): readonly DetectedMermaidDiagram[] {
    return [...(this.diagrams.get(key) ?? [])];
  }

  latest(key: K): DetectedMermaidDiagram | undefined {
    return this.diagrams.get(key)?.at(-1);
  }

  matchingDirective(
    key: K,
    directive: string,
    header: string,
  ): readonly DetectedMermaidDiagram[] {
    const normalizedHeader = normalizeDirectiveHeader(header);
    return [...(this.diagrams.get(key) ?? [])].filter(
      (item) =>
        item.directive.toLowerCase() === directive.toLowerCase() &&
        diagramDirectiveHeaders(item).includes(normalizedHeader),
    );
  }

  marked(key: K): readonly DetectedMermaidDiagram[] {
    return [...(this.diagrams.get(key) ?? [])].filter(
      (item) => item.marker !== undefined,
    );
  }

  clear(key: K): void {
    this.diagrams.delete(key);
  }
}

function diagramDirectiveHeaders(
  diagram: DetectedMermaidDiagram,
): readonly string[] {
  return diagram.source
    .split('\n')
    .filter((line) => {
      const match = findMermaidDirectiveInLine(line);
      return (
        match !== undefined &&
        line.slice(0, match.startIndex).trim().length === 0
      );
    })
    .map((line) => normalizeDirectiveHeader(line));
}

function normalizeDirectiveHeader(header: string): string {
  return header
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
