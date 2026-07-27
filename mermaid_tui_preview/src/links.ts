import {
  findMermaidDirectiveInLine,
  type DetectedMermaidDiagram,
} from './detector';

export interface DiagramLookup {
  marked(): readonly DetectedMermaidDiagram[];
  matchingDirective(
    directive: string,
    header: string,
  ): readonly DetectedMermaidDiagram[];
}

export interface ResolvedTerminalLink {
  startIndex: number;
  length: number;
  sources: readonly string[];
}

export function resolveTerminalLink(
  line: string,
  lookup: DiagramLookup,
): ResolvedTerminalLink | undefined {
  const directive = findMermaidDirectiveInLine(line);
  if (directive && isTuiPrefix(line.slice(0, directive.startIndex))) {
    const header = line.slice(directive.startIndex).trim();
    const diagrams = lookup.matchingDirective(
      directive.directive,
      header,
    );
    if (diagrams.length > 0) {
      return {
        startIndex: directive.startIndex,
        length: directive.length,
        sources: diagrams.map((diagram) => diagram.source),
      };
    }
  }

  const marker = /\bmermaid\b/i.exec(line);
  if (marker && isTuiPrefix(line.slice(0, marker.index))) {
    const diagrams = lookup.marked();
    if (diagrams.length > 0) {
      return {
        startIndex: marker.index,
        length: marker[0].length,
        sources: diagrams.map((diagram) => diagram.source),
      };
    }
  }

  return undefined;
}

function isTuiPrefix(prefix: string): boolean {
  return /^[\s•●◦⏺]*$/u.test(prefix);
}
