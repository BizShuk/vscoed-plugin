# Mermaid Preview Simplification Implementation Plan

> `執行方式`：在目前 session 以 `test-driven-development` 逐項完成；不 commit，
> 不修改使用者的 `test.md`。

`目標`：修正 Mermaid TUI detection、history selection、preview fidelity 與 viewport
互動缺陷，同時刪除不必要的 feature abstraction，縮小 production codebase。

`架構`：保留 `capture → detector → bounded history → preview panel` 的單向資料流。
`store.ts` 同時擁有 history 與 terminal-line lookup，避免 `links.ts` 的轉接介面；
Webview 直接接收原始 Mermaid source，不再經過 preview port 或 source rewrite。

`技術棧`：TypeScript、VS Code Extension API、Vitest、Mermaid 11.16、esbuild、
Playwright。

## Global Constraints

- 保留 `test.md` 現有未提交變更。
- 不新增 runtime dependency 或設定選項。
- history 每個 terminal 最多保留 `20` 張圖。
- 相同 directive header 的不同圖不得互相覆寫。
- terminal link 直接開啟最新符合圖，不顯示 diagram picker。
- partial redraw 只在 source 具有 prefix 關係且不是同 frame 圖表時合併。
- 不將 raw terminal frame 或 command content 寫入 console。
- 不改變 shell integration、PTY dimensions 與 Markdown fenced-block 契約。
- 不 commit。

---

### Task 1: Correct bounded diagram history and ambiguous link selection

`Files`

- Modify: `mermaid_tui_preview/test/store.test.ts`
- Modify: `mermaid_tui_preview/test/links.test.ts`
- Modify: `mermaid_tui_preview/src/store.ts`
- Modify: `mermaid_tui_preview/src/register.ts`

`Interfaces`

- Consumes: `DetectedMermaidDiagram`
- Produces: `MermaidDiagramStore.record()`、`latest()`、`matchingDirective()`、
  `marked()`，以及相同 header 的最新 link source

- [x] `Step 1`：新增 failing tests，證明不同 source 的相同 `flowchart LR` 均保留、
  最後更新項目成為 `latest()`、history 截斷為 `20`。
- [x] `Step 2`：執行
  `npx vitest run mermaid_tui_preview/test/store.test.ts`，確認失敗原因分別為
  slot overwrite、Map insertion order 與無上限。
- [x] `Step 3`：以 bounded ordered array 取代 directive-header Map；exact match
  移至尾端，只有跨 frame prefix-related partial source 才被替換。
- [x] `Step 4`：執行 store tests，確認新測試與既有 terminal isolation、clear、
  marker lookup 全部通過。
- [x] `Step 5`：相同 header 的 link 直接解析成最近更新的 source，不顯示 picker。

### Task 2: Match detector aliases to the bundled Mermaid renderer

`Files`

- Modify: `mermaid_tui_preview/test/detector.test.ts`
- Modify: `mermaid_tui_preview/src/detector.ts`

`Interfaces`

- Produces: `findMermaidDirectiveInLine()` 與 `detectMermaidDiagrams()` 可辨識
  Mermaid 11.16 bundled diagram header aliases

- [x] `Step 1`：新增 table-driven failing test，至少涵蓋
  `classDiagram-v2`、`flowchart-elk`、`swimlane-beta`、`info`、`xychart`、
  `requirement`、`architecture`、`treemap`、`railroad-ebnf-beta`。
- [x] `Step 2`：執行 detector test，確認上述 header 目前皆未偵測。
- [x] `Step 3`：將 directive regex 改為 compact alias catalog，移除 bundled
  renderer 未註冊的 `zenuml`，補齊 Mermaid 11.16 aliases。
- [x] `Step 4`：重新執行 detector test，確認新舊 directive contract 均通過。

### Task 3: Preserve source, remove raw logging, and fix uniform panning

`Files`

- Modify: `mermaid_tui_preview/test/preview.test.ts`
- Modify: `mermaid_tui_preview/test/capture.test.ts`
- Modify: `mermaid_tui_preview/test/viewport.test.ts`
- Modify: `mermaid_tui_preview/src/preview.ts`
- Modify: `mermaid_tui_preview/src/capture.ts`
- Modify: `mermaid_tui_preview/src/viewport.ts`
- Modify: `mermaid_tui_preview/webview/index.mts`

`Interfaces`

- Produces: source-preserving preview、silent capture、uniform SVG viewBox transform

- [x] `Step 1`：新增 failing tests，要求 `<br/>` 原樣保留、capture 不呼叫
  `console.log()`、非等比例 viewport 的 `100px` drag 對應 `100px` 視覺位移。
- [x] `Step 2`：分別執行三個 test file，確認 failure 對應現有 source rewrite、
  frame logging 與 independent-axis scale。
- [x] `Step 3`：移除 `<br>` rewrite 與所有 capture/register debug logging。
- [x] `Step 4`：以
  `max(viewBox.width / viewport.width, viewBox.height / viewport.height)` 計算
  uniform units-per-pixel。
- [x] `Step 5`：在 browser entry 直接使用 viewport size，inline SVG fill sizing，
  刪除額外 rendered-size state 與 sizing helper。
- [x] `Step 6`：重新執行三個 test file，確認全部通過且 stdout 不含 `[MTUI]`。

### Task 4: Consolidate modules and synchronize documentation

`Files`

- Delete: `mermaid_tui_preview/src/links.ts`
- Delete: `mermaid_tui_preview/test/links.test.ts`
- Delete: `mermaid_tui_preview/src/preview.ts`
- Delete: `mermaid_tui_preview/test/preview.test.ts`
- Delete: `mermaid_tui_preview/src/capture.ts`
- Delete: `mermaid_tui_preview/src/commands.ts`
- Delete: `mermaid_tui_preview/src/terminalDimensions.ts`
- Delete: `mermaid_tui_preview/src/terminalScreen.ts`
- Create: `mermaid_tui_preview/src/terminal.ts`
- Modify: `mermaid_tui_preview/src/store.ts`
- Modify: `mermaid_tui_preview/test/store.test.ts`
- Modify: `mermaid_tui_preview/src/register.ts`
- Modify: `mermaid_tui_preview/src/panel.ts`
- Modify: `mermaid_tui_preview/test/webview.test.ts`
- Modify: `mermaid_tui_preview/CLAUDE.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

`Interfaces`

- `store.ts` exports history 與 `resolveTerminalLink()`
- `terminal.ts` 集中 command detection、PTY dimensions、ANSI reconstruction 與 capture
- `panel.ts` receives Mermaid source directly
- `register.ts` owns VS Code terminal／document wiring only

- [x] `Step 1`：把 link resolution tests 移入 store test，再刪除 `links.ts`。
- [x] `Step 2`：讓 register 直接呼叫 `MermaidPreviewPanel.show()`，刪除 preview port
  與 `preview.ts`；在 webview test 保留 source fidelity regression coverage。
- [x] `Step 3`：刪除 dead helpers、imports、comments，執行 focused Mermaid tests。
- [x] `Step 4`：同步文件的模組表、bounded history、direct-latest selection、directive
  support、source fidelity 與 viewport scale 契約。
- [x] `Step 5`：比較 production TypeScript LOC 與 source file count，確認兩者均低於
  refactor 前的 `1526 lines / 14 files`。
- [x] `Step 6`：執行 `npm test`、`npm run typecheck`、`node esbuild.config.mjs`、
  `git diff --check`，再用 Playwright 重播 `test.md` 的 `11` 張圖以及
  `100px` drag。

## Self-Review

- `Spec coverage`：五項 review finding 均有 failing test、implementation 與
  final browser verification。
- `Placeholder scan`：無 `TBD`、`TODO` 或未定介面。
- `Type consistency`：production 對外入口維持 `registerMermaidTuiPreview()`；
  history 與 preview 類別名稱維持不變，避免擴大 root orchestrator 改動。
