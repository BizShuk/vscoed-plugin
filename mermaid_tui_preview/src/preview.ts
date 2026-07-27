export interface MermaidPreviewPort {
  showPreview(source: string): Promise<void>;
}

export async function openMermaidPreview(
  source: string,
  port: MermaidPreviewPort,
): Promise<void> {
  const normalizedSource = `${source.trim()}\n`;
  await port.showPreview(normalizedSource);
}
