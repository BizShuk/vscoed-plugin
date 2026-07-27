export interface MarkdownMermaidBlock {
  source: string;
  openingLine: number;
  openingStart: number;
  openingEnd: number;
  closingLine: number;
}

const MERMAID_FENCE = /^(\s*)(`{3,}|~{3,})([ \t]*)(mermaid)\b.*$/i;

export function findMarkdownMermaidBlocks(
  lines: readonly string[],
): MarkdownMermaidBlock[] {
  const blocks: MarkdownMermaidBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const opening = MERMAID_FENCE.exec(line);
    if (!opening?.[2] || !opening[4]) {
      continue;
    }

    const fence = opening[2];
    const closingLine = findClosingFence(lines, index + 1, fence);
    const bodyEnd = closingLine >= 0 ? closingLine : lines.length;
    const source = dedent(lines.slice(index + 1, bodyEnd)).trim();
    if (!source) {
      index = Math.max(index, closingLine);
      continue;
    }

    const openingStart =
      opening[1].length + fence.length + opening[3].length;
    blocks.push({
      source,
      openingLine: index,
      openingStart,
      openingEnd: openingStart + opening[4].length,
      closingLine: closingLine >= 0 ? closingLine : lines.length - 1,
    });
    index = Math.max(index, closingLine);
  }

  return blocks;
}

export function selectMarkdownMermaidBlock(
  blocks: readonly MarkdownMermaidBlock[],
  line: number,
): MarkdownMermaidBlock | undefined {
  return blocks.find(
    (block) => line >= block.openingLine && line <= block.closingLine,
  );
}

function findClosingFence(
  lines: readonly string[],
  start: number,
  openingFence: string,
): number {
  const character = openingFence[0];
  if (!character) {
    return -1;
  }

  const closing = new RegExp(
    `^\\s*${character}{${openingFence.length},}\\s*$`,
  );
  for (let index = start; index < lines.length; index += 1) {
    if (closing.test(lines[index] ?? '')) {
      return index;
    }
  }
  return -1;
}

function dedent(lines: readonly string[]): string {
  const baseIndent = Math.min(
    ...lines
      .filter((line) => line.trim().length > 0)
      .map((line) => indentation(line)),
  );
  if (!Number.isFinite(baseIndent)) {
    return '';
  }

  return lines
    .map((line) => (line.trim().length > 0 ? removeIndent(line, baseIndent) : ''))
    .join('\n');
}

function indentation(line: string): number {
  return /^\s*/.exec(line)?.[0].length ?? 0;
}

function removeIndent(line: string, width: number): string {
  let index = 0;
  while (index < line.length && index < width && /\s/.test(line[index] ?? '')) {
    index += 1;
  }
  return line.slice(index);
}
