import { describe, expect, it } from 'vitest';
import { createMermaidPreviewHTML } from '../src/webview';

describe('createMermaidPreviewHTML', () => {
  it('loads the bundled renderer and embeds source without executable markup', () => {
    const html = createMermaidPreviewHTML({
      source: 'flowchart TD\nA["</script><script>bad()</script>"]',
      scriptURI: 'vscode-webview://extension/webview.js',
      cspSource: 'vscode-webview://extension',
      nonce: 'test-nonce',
    });

    expect(html).toContain(
      '<script nonce="test-nonce" src="vscode-webview://extension/webview.js"></script>',
    );
    expect(html).toContain(
      'flowchart TD\\nA[\\"\\u003c/script>\\u003cscript>bad()\\u003c/script>\\"]',
    );
    expect(html).not.toContain('</script><script>bad()</script>');
  });

  it('documents the default left-drag interaction in the preview', () => {
    const html = createMermaidPreviewHTML({
      source: 'flowchart TD\nA --> B',
      scriptURI: 'webview.js',
      cspSource: 'self',
      nonce: 'nonce',
    });

    expect(html).toContain('Left-drag to move');
    expect(html).toContain('Scroll to zoom');
  });

  it('does not force the SVG into a rasterized CSS transform layer', () => {
    const html = createMermaidPreviewHTML({
      source: 'flowchart TD\nA --> B',
      scriptURI: 'webview.js',
      cspSource: 'self',
      nonce: 'nonce',
    });

    expect(html).not.toContain('will-change: transform');
  });

  it('lets the rendered SVG use the full preview page', () => {
    const html = createMermaidPreviewHTML({
      source: 'flowchart TD\nA --> B',
      scriptURI: 'webview.js',
      cspSource: 'self',
      nonce: 'nonce',
    });

    expect(html).toMatch(
      /#diagram \{[\s\S]*inset: 0;[\s\S]*width: 100%;[\s\S]*height: 100%;/,
    );
    expect(html).toMatch(
      /#diagram svg \{[\s\S]*width: 100%;[\s\S]*height: 100%;/,
    );
  });
});
