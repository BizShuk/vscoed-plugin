const DIRECTIVE_SOURCE = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram(?:-v2)?',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'C4(?:Context|Container|Component|Dynamic|Deployment)',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'kanban',
  'architecture-beta',
  'radar-beta',
].join('|');

const DIRECTIVE_AT_START = new RegExp(
  `^\\s*(${DIRECTIVE_SOURCE})(?=\\s|$|[:;{])`,
  'i',
);
const DIRECTIVE_IN_LINE = new RegExp(
  `(${DIRECTIVE_SOURCE})(?=\\s|$|[:;{])`,
  'i',
);

export interface DetectedMermaidDiagram {
  source: string;
  directive: string;
  marker: string | undefined;
}

export interface MermaidDirectiveMatch {
  directive: string;
  startIndex: number;
  length: number;
}

export function findMermaidDirectiveInLine(
  line: string,
): MermaidDirectiveMatch | undefined {
  const match = DIRECTIVE_IN_LINE.exec(line);
  if (!match?.[1]) {
    return undefined;
  }
  return {
    directive: match[1],
    startIndex: match.index,
    length: match[1].length,
  };
}

export function detectMermaidDiagrams(
  lines: readonly string[],
): DetectedMermaidDiagram[] {
  const diagrams: DetectedMermaidDiagram[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const visible = stripBullet(lines[index] ?? '').trim();
    const fenced = /^`{3,}\s*mermaid\s*$/i.test(visible);
    const marked = fenced || /^mermaid$/i.test(visible);

    if (marked) {
      const extracted = extractFollowing(
        lines,
        index + 1,
        fenced,
        !fenced,
      );
      const directive = findDirective(extracted.source);
      if (directive) {
        diagrams.push({
          source: extracted.source,
          directive,
          marker: 'mermaid',
        });
      }
      index = Math.max(index, extracted.endIndex);
      continue;
    }

    const content = stripBullet(lines[index] ?? '').trimStart();
    const direct = DIRECTIVE_AT_START.exec(content);
    if (!direct?.[1]) {
      continue;
    }

    const continuation = extractFollowing(lines, index + 1, false);
    const source = [content.trimEnd(), ...continuation.lines]
      .join('\n')
      .trimEnd();
    diagrams.push({
      source,
      directive: direct[1],
      marker: undefined,
    });
    index = Math.max(index, continuation.endIndex);
  }

  return diagrams.filter(
    (diagram, index) =>
      diagrams.findIndex((candidate) => candidate.source === diagram.source) ===
      index,
  );
}

function stripBullet(line: string): string {
  return line.replace(/^\s*[•●◦⏺]\s+/u, '');
}

function findDirective(source: string): string | undefined {
  for (const line of source.split('\n')) {
    const match = DIRECTIVE_AT_START.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

function extractFollowing(
  lines: readonly string[],
  startIndex: number,
  fenced: boolean,
  markerBlock = false,
): { source: string; lines: string[]; endIndex: number } {
  const relativeFirst = lines
    .slice(startIndex)
    .findIndex((line) => line.trim().length > 0);
  if (relativeFirst < 0) {
    return { source: '', lines: [], endIndex: startIndex - 1 };
  }

  const first = startIndex + relativeFirst;
  const firstIndent = indentation(lines[first] ?? '');
  const rawLines: string[] = [];
  let endIndex = first - 1;
  let pendingBlankLines = 0;
  let minimumIndent = Number.POSITIVE_INFINITY;

  for (let index = first; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (fenced && /^\s*`{3,}\s*$/.test(line)) {
      endIndex = index;
      break;
    }
    if (!fenced && index > first && isTuiDiagramStart(line)) {
      break;
    }

    if (line.trim().length === 0) {
      pendingBlankLines += 1;
      continue;
    }

    const lineIndent = indentation(line);
    if (
      !fenced &&
      pendingBlankLines > 0 &&
      (minimumIndent === 0 ||
        lineIndent < minimumIndent ||
        (markerBlock && lineIndent <= firstIndent))
    ) {
      break;
    }

    while (pendingBlankLines > 0) {
      rawLines.push('');
      pendingBlankLines -= 1;
    }
    rawLines.push(line);
    minimumIndent = Math.min(minimumIndent, lineIndent);
    endIndex = index;
  }

  const baseIndent = Number.isFinite(minimumIndent) ? minimumIndent : 0;
  const collected = rawLines.map((line) =>
    line.length === 0 ? '' : removeIndent(line, baseIndent).trimEnd(),
  );
  const source = collected.join('\n').trimEnd();
  return { source, lines: collected, endIndex };
}

function indentation(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function isTuiDiagramStart(line: string): boolean {
  const hasBullet = /^\s*[•●◦⏺]\s+/u.test(line);
  const visible = stripBullet(line).trim();
  return (
    /^mermaid$/i.test(visible) ||
    (hasBullet && DIRECTIVE_AT_START.test(visible))
  );
}

function removeIndent(line: string, width: number): string {
  let index = 0;
  while (
    index < line.length &&
    index < width &&
    /\s/.test(line[index] ?? '')
  ) {
    index += 1;
  }
  return line.slice(index);
}
