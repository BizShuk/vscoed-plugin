import type { DetectedMermaidDiagram } from './detector';
import { findMermaidDirectiveInLine } from './detector';

export interface ResolvedTerminalLink {
  startIndex: number;
  length: number;
  source: string;
}

export class MermaidDiagramStore<K extends object> {
  private readonly diagrams = new WeakMap<K, DetectedMermaidDiagram[]>();

  constructor(private readonly maximumPerKey = 20) {}

  record(
    key: K,
    detected: readonly DetectedMermaidDiagram[],
  ): void {
    const current = [...(this.diagrams.get(key) ?? [])];
    const currentFrameSources = new Set(
      detected.map((diagram) => diagram.source),
    );

    for (const diagram of detected) {
      const exactIndex = current.findIndex(
        (item) => item.source === diagram.source,
      );
      if (exactIndex >= 0) {
        current.splice(exactIndex, 1);
      } else {
        const partialIndex = current.findIndex(
          (item) =>
            !currentFrameSources.has(item.source) &&
            item.directive.toLowerCase() ===
              diagram.directive.toLowerCase() &&
            (item.source.startsWith(diagram.source) ||
              diagram.source.startsWith(item.source)),
        );
        if (partialIndex >= 0) {
          current.splice(partialIndex, 1);
        }
      }
      current.push(diagram);
    }

    this.diagrams.set(
      key,
      current.slice(-this.maximumPerKey),
    );
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
    return (this.diagrams.get(key) ?? []).filter(
      (item) =>
        item.directive.toLowerCase() === directive.toLowerCase() &&
        diagramDirectiveHeaders(item).includes(normalizedHeader),
    );
  }

  marked(key: K): readonly DetectedMermaidDiagram[] {
    return (this.diagrams.get(key) ?? []).filter(
      (item) => item.marker !== undefined,
    );
  }

  resolveTerminalLink(
    key: K,
    line: string,
  ): ResolvedTerminalLink | undefined {
    const directive = findMermaidDirectiveInLine(line);
    if (
      directive &&
      isTuiPrefix(line.slice(0, directive.startIndex))
    ) {
      const diagram = this.matchingDirective(
        key,
        directive.directive,
        line.slice(directive.startIndex).trim(),
      ).at(-1);
      if (diagram) {
        return {
          startIndex: directive.startIndex,
          length: directive.length,
          source: diagram.source,
        };
      }
    }

    const marker = /\bmermaid\b/i.exec(line);
    if (marker && isTuiPrefix(line.slice(0, marker.index))) {
      const diagram = this.marked(key).at(-1);
      if (diagram) {
        return {
          startIndex: marker.index,
          length: marker[0].length,
          source: diagram.source,
        };
      }
    }

    return undefined;
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

function isTuiPrefix(prefix: string): boolean {
  return /^[\s•●◦⏺]*$/u.test(prefix);
}
