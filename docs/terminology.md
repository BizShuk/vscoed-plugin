# 術語表 (Terminology)

## Mermaid TUI Preview

| 術語 (Term) | 英文 (English) | 定義 (Definition) | 出處 (Source) |
| ----------- | -------------- | ----------------- | ------------- |
| Mermaid 區塊 | Mermaid Diagram Block | TUI 畫面中可還原成單一 Mermaid diagram source 的連續內容 | `mermaid_tui_preview/src/detector.ts:DetectedMermaidDiagram` |
| Markdown Mermaid 區塊 | Markdown Mermaid Fenced Block | 一般 Markdown 檔中由 ` ```mermaid ` 開始、以 fence 結束的 Mermaid source 區塊 | `mermaid_tui_preview/src/markdown.ts:MarkdownMermaidBlock` |
| 終端畫面重建 | Terminal Screen Reconstruction | 將 raw ANSI terminal data 套用 cursor movement 與 redraw 後得到可掃描文字行 | `mermaid_tui_preview/src/terminalScreen.ts:TerminalScreen` |
| 終端預覽連結 | Terminal Preview Link | 附著於 `mermaid` marker 或 Mermaid directive、可觸發 diagram preview 的 terminal link | `mermaid_tui_preview/src/links.ts:ResolvedTerminalLink` |
| 文件預覽連結 | Document Preview Link | 附著於 Markdown `mermaid` opening marker、可觸發 diagram preview 的文件連結 | `mermaid_tui_preview/src/register.ts:MermaidMarkdownLinkProvider` |
| 互動式預覽面板 | Interactive Preview Panel | 以內建 Mermaid renderer 顯示 SVG，並以 `viewBox` 提供左鍵拖曳、向量縮放與重設的 VS Code webview | `mermaid_tui_preview/src/panel.ts:MermaidPreviewPanel` |

## 縮寫 (Abbreviations)

| 縮寫 | 全稱 | 說明 |
| ---- | ---- | ---- |
| TUI | Text-based User Interface | Codex 與 Claude 在 integrated terminal 中呈現的互動畫面 |
