# Mermaid TUI Preview — 技術脈絡 (Technical Context)

## 目的 (Purpose)

`Mermaid TUI Preview` 監聽 integrated terminal 內新啟動的 Codex／Claude TUI，
重建 ANSI 控制序列作用後的終端畫面，擷取 Mermaid 原始碼；同時解析一般 Markdown
檔的 ` ```mermaid ` fenced code block，提供文件連結與 command 開啟內建互動式
Mermaid webview。

## 資料流 (Data Flow)

```text
TerminalShellExecution.read()
  → TerminalScreen.write()
  → detectMermaidDiagrams()
  → MermaidDiagramStore.record()
  → MermaidDiagramStore.resolveTerminalLink()
  → MermaidPreviewPanel.show()
  → Mermaid SVG render + viewBox transform

Markdown TextDocument
  → findMarkdownMermaidBlocks()
  → DocumentLinkProvider / openMarkdown command
  → MermaidPreviewPanel.show()
```

## 模組對應 (Module Mapping)

| 模組 | 職責 | 主要介面 |
| ---- | ---- | -------- |
| `src/terminal.ts` | 判斷 TUI command、探測 PTY dimensions、重建 ANSI 畫面並串接 capture | `isSupportedTuiCommand()`、`resolveTerminalDimensions()`、`TerminalScreen`、`captureMermaidStream()` |
| `src/detector.ts` | 從重建畫面擷取 Mermaid 區塊與圖型指令 | `detectMermaidDiagrams()` |
| `src/store.ts` | 依 terminal 快取最近 20 張圖、合併 partial render 並解析 terminal link | `MermaidDiagramStore` |
| `src/markdown.ts` | 解析 Markdown ` ```mermaid ` fenced code block 與游標選取 | `findMarkdownMermaidBlocks()` |
| `src/panel.ts` | 建立／重用 VS Code webview panel | `MermaidPreviewPanel` |
| `src/webview.ts` | 產生具 CSP 與安全 source embedding 的 HTML | `createMermaidPreviewHTML()` |
| `src/viewport.ts` | 左鍵拖曳、縮放與 SVG `viewBox` 的純狀態轉換 | `calculateSVGViewBox()` |
| `webview/index.mts` | Mermaid render 與 pointer／wheel DOM event wiring | browser entry |
| `src/register.ts` | 註冊 VS Code execution listener、terminal/document link provider 與 command | `registerMermaidTuiPreview()` |

## API 邊界 (API Boundaries)

- VS Code engine 最低版本為 `1.93`，因為 stable
  `window.onDidStartTerminalShellExecution` 與
  `TerminalShellExecution.read()` 由該版本提供。
- listener 必須在 start event 內立即呼叫 `execution.read()`；API 不會補送首次
  `read()` 之前已寫入的 terminal data。
- terminal data 含 ANSI cursor positioning、erase、alternate-screen 與色彩控制碼。
  不可只刪除 escape sequence，否則多次 redraw 會疊成錯誤文字。
- VS Code stable API 不公開一般 terminal 的 dimensions；macOS／Linux 由
  `Terminal.processId` 經 `ps` 與 `stty` 解析 PTY dimensions。headless terminal
  使用實際 columns 以重現 soft wrap，rows 則至少保留 `120` 行以容納長圖。
- preview panel 使用 module 內建的 Mermaid browser bundle，不依賴其他 VS Code
  extension；source 以 JSON data script 安全嵌入，Mermaid 使用 `securityLevel:
  'strict'`。preview 不重寫合法的 Mermaid markup，例如 `<br/>` 會原樣傳入 renderer。
- capture 不輸出 raw terminal frame 或 command content；執行錯誤只由註冊層寫入
  `console.error()`。
- webview 預設啟用滑鼠左鍵拖曳，以 pointer capture 保證游標離開圖形後仍持續平移；
  滾輪與 toolbar 提供 `25%` 至 `400%` 縮放及 reset。平移與縮放只更新 SVG
  `viewBox`，不以 CSS `scale()` 放大 rasterized composition layer；寬高比例不同時
  使用單一等比例 (uniform) scale 換算 pointer movement。

## 偵測契約 (Detection Contract)

- 支援的 executable basename 為 `codex`、`claudem`、`claude` 與
  `claude-code`；完整路徑同樣以 basename 判定。
- Claude TUI 以獨立 `mermaid` marker 開始，後續縮排行為圖的 source。
- Codex TUI 會隱藏 Markdown fence 與 language marker，因此直接從
  `flowchart`、`sequenceDiagram`、`stateDiagram-v2` 等 Mermaid directive 開始。
- directive catalog 對齊內建 Mermaid `11.16` renderer，包含
  `classDiagram-v2`、`flowchart-elk`、`architecture`、`treemap`、
  `railroad-ebnf-beta` 等 bundled aliases。
- terminal link provider 會連結兩種 TUI 的 Mermaid directive；Claude 的
  `mermaid` marker 是額外入口，不是另一套必要關鍵字。
- Markdown ` ```mermaid ` opening marker 會成為文件連結；游標位於 fenced block
  內時，`Mermaid TUI Preview: Open Markdown Diagram` command 會開啟該 block。
- Markdown fenced block 會移除 code fence 與區塊共同縮排；未閉合 fence 會讀到文件結尾。
- detector 以區塊內共同最小縮排移除 renderer padding，保留 Mermaid 自身的語意
  縮排。
- terminal physical row 的 `isWrapped` continuation 會先接回 logical line，再交給
  detector；換行不能直接視為 Mermaid source newline。
- 非 fenced TUI block 遇到下一個 diagram marker／directive，或空白後回到 renderer
  基準縮排時即結束，避免把後續 prose 併入 Mermaid source。
- 每個 raw data chunk 會在 `CR`／`LF` 與 cursor-home／absolute-position redraw
  邊界建立中間 frame，避免長圖的起始 directive 在同一 chunk 內被覆蓋後才掃描。
- 每個 terminal 使用最多 `20` 張圖的 ordered history；相同 source 再次出現會移至
  最後並成為 `latest()`，相同 directive header 的不同 source 則同時保留。
- partial stream 會先產生短 source；store 只在跨 frame 且 source 具有 prefix 關係時
  替換成較完整 source。同一個畫面掃描內同時存在的 prefix-related diagrams 則保留
  為不同圖。
- terminal link 以完整 directive header（例如 `flowchart TD`）比對；若多張圖的
  可見 header 完全相同，直接開啟最近更新的一張，不顯示 picker。

## 測試 (Tests)

```bash
npx vitest run mermaid_tui_preview/test
npm test
npm run typecheck
```

`test/terminalScreen.test.ts`、`test/terminalDimensions.test.ts` 與
`test/capture.test.ts` 使用實際 Codex／Claude TUI 控制序列的縮小 fixture，驗證
PTY dimensions、soft wrap、cursor movement 與端對端擷取。
`test/markdown.test.ts` 驗證 Markdown fenced block 的解析、共同縮排移除與游標選取。
`test/viewport.test.ts` 驗證只有左鍵能啟動拖曳、放開後停止，以及縮放邊界；
`test/fixtures/interactive-preview.html` 提供 browser interaction fixture。

## 已知限制 (Known Limits)

- 只監聽 shell integration 能辨識的新 command execution。
- extension 啟動前的 terminal scrollback 不會被回溯掃描。
- PTY dimensions probe 目前支援 macOS／Linux；其他平台使用 headless terminal
  fallback dimensions。command 執行期間若 terminal resize，該次 capture 不會重新
  probe。
- terminal link API 不提供 scrollback row number；相同完整 header 或相同
  `mermaid` marker 出現多次時，無法由點擊列自動判斷圖的位置，因此固定開啟
  最近更新且符合該 link 的圖。
