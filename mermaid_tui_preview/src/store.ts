import type { DetectedMermaidDiagram } from './detector';
import { findMermaidDirectiveInLine } from './detector';

type DiagramKey = string;

/**
 * Per-terminal diagram cache keyed by `${directive}::${normalizedHeader}`.
 *
 * The earlier single-slot model collapsed every diagram in a terminal into
 * one entry, which mixed in-flight renders of unrelated charts. The per-id
 * model keeps one slot per directive+header pair so:
 *
 *   - editing the same `flowchart TD` overwrites only its slot, leaving
 *     co-resident `flowchart LR` or `sequenceDiagram` diagrams intact;
 *   - opening the latest capture of an id is one map lookup;
 *   - the link provider still gets exactly one diagram per directive line
 *     click without needing a Quick Pick disambiguator.
 */
export class MermaidDiagramStore<K extends object> {
  private readonly diagrams = new WeakMap<K, Map<DiagramKey, DetectedMermaidDiagram>>();

  record(key: K, detected: readonly DetectedMermaidDiagram[]): void {
    if (detected.length === 0) {
      return;
    }
    const slot =
      this.diagrams.get(key) ??
      new Map<DiagramKey, DetectedMermaidDiagram>();
    for (const diagram of detected) {
      slot.set(diagramIdentityKey(diagram), diagram);
    }
    this.diagrams.set(key, slot);
  }

  entries(key: K): readonly DetectedMermaidDiagram[] {
    const slot = this.diagrams.get(key);
    return slot ? [...slot.values()] : [];
  }

  latest(key: K): DetectedMermaidDiagram | undefined {
    const slot = this.diagrams.get(key);
    if (!slot) {
      return undefined;
    }
    let last: DetectedMermaidDiagram | undefined;
    for (const value of slot.values()) {
      last = value;
    }
    return last;
  }

  matchingDirective(
    key: K,
    directive: string,
    header: string,
  ): readonly DetectedMermaidDiagram[] {
    const slot = this.diagrams.get(key);
    if (!slot) {
      return [];
    }
    const target = identityKeyFor(directive, header);
    const hit = slot.get(target);
    return hit ? [hit] : [];
  }

  marked(key: K): readonly DetectedMermaidDiagram[] {
    const slot = this.diagrams.get(key);
    if (!slot) {
      return [];
    }
    return [...slot.values()].filter((item) => item.marker !== undefined);
  }

  clear(key: K): void {
    this.diagrams.delete(key);
  }
}

function diagramIdentityKey(diagram: DetectedMermaidDiagram): DiagramKey {
  const firstHeader = diagramDirectiveHeaders(diagram).at(0);
  return identityKeyFor(diagram.directive, firstHeader ?? diagram.directive);
}

function identityKeyFor(directive: string, header: string): DiagramKey {
  return `${normalizeDirectiveHeader(directive)}::${normalizeDirectiveHeader(header)}`;
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
