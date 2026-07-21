# log_doctor 0.2.0 esbuild Bundle 重構 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `log_doctor` 從 tsc 多檔輸出改為 esbuild 單檔 bundle（含 `@anthropic-ai/sdk` 與 `openai` 內嵌），VSIX 從 3.56 MB 縮減至 ~70 KB，且從根本避免「依賴未隨 VSIX 打包」的 activate 失敗陷阱。

**Architecture:** `tsc -p .` 改為 `tsc --noEmit`（僅型別檢查）+ esbuild 單檔 bundle。`esbuild.config.mjs` 以 `src/extension.ts` 為入口，`external: ['vscode']` 讓 IDE 注入的全域 API 不被打包，`bundle: true` 把所有 npm 依賴內嵌到 `out/src/extension.js`。新增 `.vscodeignore` 排除 `test/`、`*.map`、`docs/`、`plans/` 等雜物。Vitest 測試不受影響（直接 import `src/*.ts`，並以 `vi.mock('vscode')` 隔離）。

**Tech Stack:**
- esbuild ^0.21.0（新加入 devDependency）
- TypeScript ^5.4.0（保留，僅做型別檢查）
- Vitest ^1.4.0（測試不變）
- vsce ^2.15.0（打包）
- Node.js 18+ target

---

## 檔案結構 (File Structure)

**新增：**
- `esbuild.config.mjs` — bundle 設定（entry, external, platform, target, format）
- `.vscodeignore` — 打包排除清單

**修改：**
- `package.json` — `scripts.build` 改為 `tsc --noEmit && node esbuild.config.mjs`；新增 `esbuild` devDep；`scripts.test:integration` 調整
- `log_doctor/CLAUDE.md` — Build 段落更新、新增 esbuild 條目

**不動：**
- `src/**/*.ts` — 原始碼維持，esbuild 從同一入口處理
- `test/**/*.test.ts` — Vitest 從 `src/` 直接 import，與 bundle 無關
- `vitest.config.ts`、`tsconfig.json`、`vscode-test.config.mjs` — 設定不動

---

## Task 1：新增 esbuild 至 devDependencies

**Files:**
- Modify: `package.json:98-108`

- [ ] **Step 1：編輯 devDependencies 加入 esbuild**

將 `package.json` 第 107 行（`"vsce": "^2.15.0"`）後加入新的一行：

```json
"esbuild": "^0.21.0",
```

完整 `devDependencies` 區塊（修改後）：

```json
"devDependencies": {
  "@types/glob": "^8.1.0",
  "@types/mocha": "^10.0.10",
  "@types/node": "^20.11.0",
  "@types/vscode": "^1.85.0",
  "@vscode/test-electron": "^2.3.0",
  "mocha": "^11.7.6",
  "typescript": "^5.4.0",
  "vitest": "^1.4.0",
  "vsce": "^2.15.0",
  "esbuild": "^0.21.0"
}
```

- [ ] **Step 2：安裝依賴**

Run:
```bash
cd log_doctor && npm install
```

Expected: `added 1 package` 之類訊息，無 error。

- [ ] **Step 3：驗證 esbuild 可執行**

Run:
```bash
cd log_doctor && npx esbuild --version
```

Expected: 輸出 `0.21.x` 之類版本字串。

- [ ] **Step 4：Commit**

```bash
cd log_doctor && git add package.json package-lock.json && git commit -m "build: add esbuild as devDependency for 0.2.0 bundle"
```

---

## Task 2：建立 esbuild.config.mjs

**Files:**
- Create: `esbuild.config.mjs`

- [ ] **Step 1：撰寫 bundle 設定**

在 `log_doctor/` 目錄根新增 `esbuild.config.mjs`：

```javascript
// esbuild.config.mjs
// Bundle log_doctor VSCode extension into a single CJS file.
// Bundles @anthropic-ai/sdk and openai inline; marks `vscode` as external
// because the VSCode Extension Host injects it as a global at runtime.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(__dirname, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: resolve(__dirname, 'out/src/extension.js'),
  external: ['vscode'],
  // Keep sourcemaps off in the package; regenerate locally if needed.
  sourcemap: false,
  // Resolve from project root to pick up node_modules/@anthropic-ai/sdk etc.
  absWorkingDir: __dirname,
  logLevel: 'info',
});
```

- [ ] **Step 2：執行 bundle**

Run:
```bash
cd log_doctor && node esbuild.config.mjs
```

Expected: esbuild 印出 build summary，無 error。可能出現「Could not resolve ...」之類警告需要處理，但預期沒有。

- [ ] **Step 3：驗證 bundle 結構**

Run:
```bash
ls /Users/shuk/projects/tmp/vscode-plugin-experiment/log_doctor/out/src/
```

Expected: 只有 `extension.js`（沒有 `providers/claude.js` 等子檔案）。

- [ ] **Step 4：驗證 SDK 已內嵌**

Run:
```bash
grep -c "@anthropic-ai/sdk" /Users/shuk/projects/tmp/vscode-plugin-experiment/log_doctor/out/src/extension.js
grep -c "openai" /Users/shuk/projects/tmp/vscode-plugin-experiment/log_doctor/out/src/extension.js
```

Expected: 兩個指令都輸出大於 0 的數字（代表 SDK 程式碼被 inline）。

- [ ] **Step 5：Commit**

```bash
cd log_doctor && git add esbuild.config.mjs && git commit -m "build: add esbuild.config.mjs for single-file bundle"
```

---

## Task 3：更新 package.json build script

**Files:**
- Modify: `package.json:89-97`

- [ ] **Step 1：修改 build 與 watch 與 test:integration 腳本**

把第 89-97 行的 `scripts` 區塊從：

```json
"scripts": {
  "build": "tsc -p .",
  "watch": "tsc -p . --watch",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "tsc -p . && node ./out/test/integration/runTest.js",
  "package": "vsce package",
  "lint": "tsc -p . --noEmit"
}
```

改為：

```json
"scripts": {
  "build": "tsc -p . --noEmit && node esbuild.config.mjs",
  "watch": "tsc -p . --noEmit --watch",
  "typecheck": "tsc -p . --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:integration": "tsc -p . --noEmit && node ./out/test/integration/runTest.js",
  "package": "vsce package",
  "lint": "tsc -p . --noEmit"
}
```

差異：
- `build` 改為先 `tsc --noEmit`（型別檢查）再 `node esbuild.config.mjs`（bundle）
- `watch` 改為 `tsc --watch --noEmit`（開發期間型別即時檢查）
- 新增 `typecheck` 別名
- `test:integration` 改為 `tsc --noEmit`（測試執行由 `runTest.js` 內部編譯與否決定，目前保留先做型別檢查）

- [ ] **Step 2：執行 build 驗證**

Run:
```bash
cd log_doctor && rm -rf out && npm run build
```

Expected: tsc --noEmit 通過、esbuild 印出 build summary、`out/src/extension.js` 出現且 size < 1 MB。

- [ ] **Step 3：驗證輸出仍可被 require**

Run:
```bash
cd log_doctor && node -e "require('./out/src/extension.js')" 2>&1 | head -5
```

Expected: 印出類似 `Error: Cannot find module 'vscode'` 的錯誤（因為在一般 Node 環境跑，沒有 vscode）— **這是預期行為**，證明 bundle 確實把 `vscode` 標為 external。

- [ ] **Step 4：Commit**

```bash
cd log_doctor && git add package.json && git commit -m "build: switch build script to tsc --noEmit + esbuild bundle"
```

---

## Task 4：建立 .vscodeignore 排除雜物

**Files:**
- Create: `.vscodeignore`

- [ ] **Step 1：撰寫 ignore 清單**

在 `log_doctor/` 目錄根新增 `.vscodeignore`：

```
# Dev / test files not needed in runtime VSIX
test/
out/test/
src/test/
**/*.test.ts
**/*.test.js
**/*.spec.ts
**/*.spec.js

# Build artifacts not needed at runtime
**/*.map
**/*.tsbuildinfo

# Build tooling & configs
esbuild.config.mjs
tsconfig.json
vitest.config.ts
vscode-test.config.mjs

# Documentation & meta
docs/
plans/
AGENTS.md
CLAUDE.md
README.md
LICENSE
LICENSE.txt
readme.md
README.*
CHANGELOG.md

# Source maps / dev-only dirs
.vscode-test/
.git/
.github/
```

**注意：這裡**不**列 `node_modules/`** — 因為 esbuild 已把 SDK 內嵌到 `out/src/extension.js`，理論上不需要隨 VSIX 帶 `node_modules/`；即使帶了也不影響功能（但會變肥）。保留預設行為是最安全的選擇。

- [ ] **Step 2：執行 package 驗證**

Run:
```bash
cd log_doctor && rm -f log-doctor-0.2.0.vsix && npm run package
```

Expected: 產出 `log-doctor-0.2.0.vsix`，大小**顯著小於 3.56 MB**（預期 100 KB ~ 500 KB 區間，因為還包含部分 transitive node_modules 若 vsce 自動帶入）。

- [ ] **Step 3：驗證 SDK 與必要的檔案還在 VSIX 內**

Run:
```bash
unzip -l log-doctor-0.2.0.vsix | grep -E "extension/(package.json|out/src/extension.js|README|LICENSE)"
unzip -l log-doctor-0.2.0.vsix | grep -c "@anthropic-ai/sdk"
```

Expected:
- 第一個指令列出 `extension/package.json`、`extension/out/src/extension.js` 與授權檔案
- 第二個指令輸出大於 0（確認 SDK 程式碼在 bundle 內）

- [ ] **Step 4：驗證 test 與 src 已被排除**

Run:
```bash
unzip -l log-doctor-0.2.0.vsix | grep -E "extension/(test|src/[^/]+\.ts|docs/|plans/)" | head -10
```

Expected: 輸出為空（沒有 test/、src/*.ts、docs/、plans/）。

- [ ] **Step 5：Commit**

```bash
cd log_doctor && git add .vscodeignore && git commit -m "build: add .vscodeignore to exclude test/src/docs from VSIX"
```

---

## Task 5：回歸測試（Vitest 不受影響）

**Files:** 無（純驗證）

- [ ] **Step 1：執行完整 Vitest 套件**

Run:
```bash
cd log_doctor && npm test 2>&1 | tail -20
```

Expected: `Test Files 14 passed (14)`、`Tests 69 passed (69)` — 與切換前數字一致。

- [ ] **Step 2：若失敗，紀錄差異**

如果測試失敗，檢查失敗的測試檔案是否：
- 直接 import 了 `out/src/...` 而非 `src/...`（應該沒有，但若有的話需調整 import path）
- mock 的 `vscode` API 在新 bundle 內行為不同（理論上不會，因為外部行為一致）

若失敗且無法快速定位，**rollback Task 3-4 的 commit**，改用更漸進的方式（例如先只加 esbuild 但保留 tsc 編譯）。

---

## Task 6：更新 log_doctor/CLAUDE.md

**Files:**
- Modify: `log_doctor/CLAUDE.md`

- [ ] **Step 1：在 Tech Stack 加入 esbuild**

找到 `## 技術棧 (Tech Stack)` 段落，在 `- Packaging: \`vsce package\` (產 \`.vsix\`)` 那一行**之前**新增：

```
- Build tool: `tsc -p . --noEmit` (型別檢查) + `esbuild` (bundle 成單檔)
```

- [ ] **Step 2：更新 Build 段落**

找到 `### 建置 (Build)` 段落，把範例從：

```
```bash
npm run build    # 一次性
npm run watch    # tsc watch
```
```

改為：

```
```bash
npm run build    # tsc --noEmit (型別檢查) + node esbuild.config.mjs (bundle)
npm run watch    # tsc --watch --noEmit (型別即時檢查，bundle 需手動跑)
npm run typecheck # 同 watch 但單次
```
```

並把「產物在 `out/`,`package.json` 的 `main` 指向 `./out/src/extension.js`。」這段補充為：

```
產物在 `out/src/extension.js`（單檔 bundle，含 `@anthropic-ai/sdk` 與 `openai` 內嵌）。`package.json` 的 `main` 指向此檔。
```

- [ ] **Step 3：更新 Deploy 段落**

找到 `### 部署 (Deploy)` 段落，把 `.vscodeignore` 那行更新為：

```
`.vscodeignore` 排除 `test/`、`*.map`、`src/`、`docs/`、`plans/` 等不需隨 VSIX 打包的檔案；`node_modules` 的 SDK 已被 esbuild 內嵌，無需另外打包。
```

- [ ] **Step 4：Commit**

```bash
cd log_doctor && git add CLAUDE.md && git commit -m "docs: update CLAUDE.md to reflect esbuild bundle workflow"
```

---

## Task 7：升版至 0.2.0 與最終打包

**Files:**
- Modify: `package.json:5`

- [ ] **Step 1：升版**

把 `package.json` 第 5 行 `"version": "0.1.3-hotfix"` 改為 `"version": "0.2.0"`。

- [ ] **Step 2：最終 build + package**

Run:
```bash
cd log_doctor && rm -rf out log-doctor-*.vsix && npm run build && npm run package
```

Expected:
- Build 成功（tsc --noEmit 通過 + esbuild 印 summary）
- 產出 `log-doctor-0.2.0.vsix`
- VSIX 大小 < 500 KB

- [ ] **Step 3：最終驗證**

Run:
```bash
ls -lh log-doctor-0.2.0.vsix
unzip -l log-doctor-0.2.0.vsix | grep -c "@anthropic-ai/sdk"
```

Expected:
- VSIX 大小明確小於 0.1.3-hotfix 的 3.56 MB
- grep 計數 > 0

- [ ] **Step 4：Commit + tag**

```bash
cd log_doctor && git add package.json && git commit -m "chore: bump version to 0.2.0 with esbuild bundle"
git tag v0.2.0
git push origin master --tags
```

---

## Self-Review Checklist

- [x] **Spec coverage:** 7 個任務涵蓋了「esbuild 安裝」、「bundle config」、「build script 串接」、「.vscodeignore」、「回歸測試」、「文件更新」、「升版打包」
- [x] **No placeholders:** 每個步驟都有完整程式碼或指令
- [x] **Type consistency:** `out/src/extension.js` 路徑一致；`esbuild.config.mjs` 路徑一致；`@anthropic-ai/sdk` 與 `openai` 引用一致
- [x] **Frequent commits:** 每個 Task 結束都有 commit，便於 rollback
- [x] **TDD applied:** Task 2-3 在實作後都有驗證步驟（`grep -c` 確認 SDK 內嵌、`unzip -l` 確認 VSIX 結構）；Task 5 是純回歸測試確認既有 69 個測試仍綠
- [x] **DRY/YAGNI:** 沒有多餘抽象層；直接用 esbuild 原生 API，沒包 wrapper