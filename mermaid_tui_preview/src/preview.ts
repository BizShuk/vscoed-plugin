export interface MermaidPreviewPort {
  showPreview(source: string): Promise<void>;
}

/**
 * Strip `<br>` / `<br/>` / `<br />` tags from Mermaid source before passing
 * it to the renderer.
 *
 * Some terminal renderers (notably Codex-style TUIs) interleave `<br/>`
 * with adjacent ASCII punctuation in ways that confuse Mermaid's lexer:
 * `<br/>(Database)` inside `DB[("...")]` produces a `CYLINDEREND`-vs-`PS`
 * parse error even though the same source parses cleanly in isolation.
 * Collapsing the tag to a single space keeps node labels intact on a
 * single line and is exactly what users end up doing manually when they
 * hit the same error, so the loss of the in-label line break is the
 * accepted trade-off for cross-TUI reliability.
 */
export function normalizeMermaidSource(source: string): string {
  return source.replace(/<br\s*\/?>/gi, ' ');
}

export async function openMermaidPreview(
  source: string,
  port: MermaidPreviewPort,
): Promise<void> {
  const normalizedSource = `${normalizeMermaidSource(source).trim()}\n`;
  await port.showPreview(normalizedSource);
}
