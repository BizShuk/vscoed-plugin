# Plan: Restore `log_doctor/` Folder & Lock Folder-as-Feature Layout

## Context

`vscode-plugin-experiment/` 目前的程式碼全平舖在 root `src/`、`test/`、`plans/`,失去「以資料夾區隔功能模組」的多模組擴充意圖。`README.md` 中的插件功能索引與現存實作路徑已脫鉤,造成兩個問題:

1. **文件與實作漂移** — `README.md` 寫 `log_doctor/extension.ts`,實際是 `src/extension.ts`,新人無法對照
2. **無法擴展** — 未來新增 sibling 插件時(例如格式器、snippet 管理器),沒有清楚的歸屬慣例可循

目標:把 `log_doctor/` 子資料夾還原為單一功能模組的容器,讓未來每個新插件都遵循同一個 folder-as-feature pattern。`src/` 與 `test/` 物理移入 `log_doctor/`,root 建置檔 (`package.json`、`esbuild.config.mjs`、`tsconfig.json`、`vitest.config.ts`) 透過 include/entryPoints 路徑指向子資料夾,維持單一 extension manifest 在 root 聚合所有 feature。

---

## 結構變更 (Structural Changes)

### Before (現在)

```
vscode-plugin-experiment/
├── src/
│   ├── extension.ts
│   ├── listener.ts
│   ├── ... (15 檔案)
│   └── providers/ (4 檔案)
├── test/
│   ├── *.test.ts (12 檔案)
│   └── providers/ (3 檔案)
├── plans/
│   └── log-doctor*.md, verify-log-doctor.md (5 檔案)
├── docs/superpowers/
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── vitest.config.ts
└── CLAUDE.md
```

### After (目標)

```
vscode-plugin-experiment/
├── log_doctor/                        # [Plugin Feature 1] LLM 自動修復診斷
│   ├── src/
│   │   ├── extension.ts
│   │   ├── listener.ts
│   │   ├── ... (15 檔案)
│   │   └── providers/ (4 檔案)
│   ├── test/
│   │   ├── *.test.ts (12 檔案)
│   │   └── providers/ (3 檔案)
│   ├── plans/                          # log_doctor 專屬規劃文件
│   │   ├── 2026-06-16-log-doctor.md
│   │   ├── 2026-06-19-log-doctor-channel-listener.md
│   │   ├── 2026-06-19-log-doctor-channel-listener-impl.md
│   │   ├── 2026-06-19-log-doctor-esbuild-bundle.md
│   │   └── verify-log-doctor.md
│   └── CLAUDE.md                       # log_doctor 技術脈絡
│
├── docs/superpowers/                   # root 跨模組設計文件
├── plans/                              # root 跨模組規劃文件 (此 PR 後為空,預留)
│
├── package.json                        # root VSCode extension manifest (聚合所有 feature)
├── tsconfig.json                       # include: log_doctor/src/**, log_doctor/test/**
├── esbuild.config.mjs                  # entry: log_doctor/src/extension.ts
├── vitest.config.ts                    # include: log_doctor/test/**/*.test.ts
├── .vscodeignore
├── README.md
└── CLAUDE.md                           # root 結構索引 + 「如何新增插件」指南
```

---

## 實作步驟 (Implementation Steps)

### 1. 物理搬移原始碼與測試

```bash
cd /Users/shuk/projects/playground/vscode-plugin-experiment

# 建立目標資料夾
mkdir -p log_doctor/src/providers log_doctor/test/providers log_doctor/plans

# 搬移 src (含 providers 子資料夾)
git mv src/* log_doctor/src/
git mv src/providers/* log_doctor/src/providers/
rmdir src/providers src

# 搬移 test (含 providers 子資料夾)
git mv test/* log_doctor/test/
git mv test/providers/* log_doctor/test/providers/
rmdir test/providers test

# 搬移 log-doctor 專屬 plans
git mv plans/2026-06-16-log-doctor.md \
       plans/2026-06-19-log-doctor-channel-listener.md \
       plans/2026-06-19-log-doctor-channel-listener-impl.md \
       plans/2026-06-19-log-doctor-esbuild-bundle.md \
       plans/verify-log-doctor.md \
       log_doctor/plans/
```

> 使用 `git mv` 以保留 commit log 中的 rename 紀錄,而非 delete+add。

### 2. 更新 root 建置設定路徑

**`package.json`** (僅改 `main` 與 scripts):

```diff
-  "main": "./out/src/extension.js",
+  "main": "./out/log_doctor/src/extension.js",
```

`scripts.build`、`scripts.test`、`scripts.package` 維持不變 — 它們呼叫 `tsc -p .`、`vitest`、`vsce`,config 已涵蓋新路徑。

**`esbuild.config.mjs`**:

```diff
-  entryPoints: [resolve(__dirname, 'src/extension.ts')],
+  entryPoints: [resolve(__dirname, 'log_doctor/src/extension.ts')],
   ...
-  outfile: resolve(__dirname, 'out/src/extension.js'),
+  outfile: resolve(__dirname, 'out/log_doctor/src/extension.js'),
```

**`tsconfig.json`**:

```diff
-  "include": ["src/**/*", "test/**/*"],
+  "include": ["log_doctor/src/**/*", "log_doctor/test/**/*"],
```

`rootDir: "."` 不變 — TypeScript 會自動推算 `log_doctor/` 到 `out/log_doctor/` 的映射。

**`vitest.config.ts`**:

```diff
   test: {
-    include: ['test/**/*.test.ts'],
-    exclude: ['node_modules/**', 'test/integration/**'],
+    include: ['log_doctor/test/**/*.test.ts'],
+    exclude: ['node_modules/**', 'log_doctor/test/integration/**'],
     environment: 'node',
     globals: false,
     coverage: {
       provider: 'v8',
-      include: ['src/**/*.ts'],
-      exclude: ['src/extension.ts', 'src/providers/factory.ts'],
+      include: ['log_doctor/src/**/*.ts'],
+      exclude: ['log_doctor/src/extension.ts', 'log_doctor/src/providers/factory.ts'],
     },
   },
```

**`.vscodeignore`** — 維持不變。原 `test/`、`*.test.ts`、`docs/`、`plans/` 等 pattern 是相對任一層級,搬到 `log_doctor/test/` 後仍會被正確排除。

### 3. 建立 `log_doctor/CLAUDE.md` (feature 技術脈絡)

建立 `log_doctor/CLAUDE.md` 收納此 feature 的內部技術決策,符合 root CLAUDE.md 中「更多細節見 `log_doctor/CLAUDE.md` 的 Build 段落」的現存引用。

內容涵蓋:

- 模組職責對應表 (`extension.ts` 等 15 檔的職責簡述)
- `esbuild` 打包設定表 (沿用 root CLAUDE.md 既有的表格)
- 同源去重 (deduplication) 指紋演算法
- `applyDedup` 冷卻邊界行為
- LLM provider 介面 (`providers/provider.ts`) 與擴充點

### 4. 重寫 root `CLAUDE.md`

新內容以「folder-as-feature」為骨幹,包含:

| 段落 | 用途 |
|------|------|
| `## 常用指令 (Commands)` | `npm install`、`npm run build`、`npm test`、`npm run package` (從 root 跑,所有路徑由 config 處理) |
| `## 資料夾即功能 (Folder-as-Feature)` | 說明每個子資料夾 = 一個獨立插件功能 |
| `## 插件功能測試索引 (Plugin Feature Index)` | 表格列出 log_doctor 與未來 sibling |
| `## 專案結構樹 (Project Tree)` | 圖示新的資料夾佈局 |
| `## 新增插件功能 (How to Add a Feature Module)` | Step-by-step: 新 sibling 資料夾 → 加 src/ 與 test/ → 在 `package.json` 的 `activationEvents` 與 `contributes.commands` 註冊 → 必要時在 `vitest.config.ts` 加 include pattern |

### 5. 更新 `README.md` 路徑引用

`README.md` 引用 `./package.json` 的部分是正確的(指向 root)。檢視「專案結構」段落:

```diff
 vscode-plugin-experiment/
 ├── README.md
-├── log_doctor/               # [Plugin Feature 1] LLM 自動修復診斷
+├── log_doctor/                # [Plugin Feature 1] LLM 自動修復診斷
 │   ├── src/
 │   │   ├── extension.ts
-│   │   ├── ...               # 與上面結構保持一致
+│   │   ├── ...                # 15 個檔案
```

`README.md` 提及的「插件功能索引」段落已對齊,不需更動。

---

## 關鍵檔案 (Critical Files)

| 檔案 | 變更類型 |
|------|---------|
| `package.json` | 改 `main` 路徑 |
| `esbuild.config.mjs` | 改 `entryPoints` + `outfile` |
| `tsconfig.json` | 改 `include` |
| `vitest.config.ts` | 改 `include`/`exclude`/`coverage` 路徑 |
| `vscode-plugin-experiment/CLAUDE.md` | 重寫 — folder-as-feature layout + 新插件指南 |
| `vscode-plugin-experiment/log_doctor/CLAUDE.md` | 新建 — log_doctor 內部技術脈絡 |
| `src/**/*` (15 檔 + 4 個 providers) | `git mv` → `log_doctor/src/` |
| `test/**/*` (12 檔 + 3 個 providers test) | `git mv` → `log_doctor/test/` |
| `plans/log-doctor*.md` (5 檔) + `plans/verify-log-doctor.md` | `git mv` → `log_doctor/plans/` |

---

## 驗證 (Verification)

依序執行,任何一步失敗即停止:

```bash
cd /Users/shuk/projects/playground/vscode-plugin-experiment

# 1. 型別檢查:include 改完後,tsc 應無 error
npm run typecheck

# 2. 單元測試:vitest 應從 log_doctor/test/ 找到原 15 個 test 檔案,結果與搬移前一致
npm test

# 3. 打包:esbuild 應從 log_doctor/src/extension.ts 入口產出 out/log_doctor/src/extension.js
npm run build
ls out/log_doctor/src/extension.js

# 4. 產出 VSIX:vsce 應讀取 root package.json + out/log_doctor/src/extension.js 打包成功
npm run package
ls vscode-plugin-experiment-0.3.0.vsix

# 5. 大小對比:搬移後的 VSIX 應與搬移前接近 (差異僅來自目錄結構,無功能異動)
ls -la vscode-plugin-experiment-0.3.0.vsix

# 6. 結構驗證
test -f log_doctor/src/extension.ts && echo "src moved OK"
test -d log_doctor/test && echo "test moved OK"
test -d log_doctor/plans && [ "$(ls log_doctor/plans | wc -l)" = "5" ] && echo "plans moved OK"
test ! -d src && test ! -d test && echo "root cleaned OK"
```

### 預期結果

- `npm run typecheck` — 0 error
- `npm test` — 全綠,測試檔案數 15 個不變
- `npm run build` — 產出 `out/log_doctor/src/extension.js`,單檔 ~150 KB
- `npm run package` — 產出 `vscode-plugin-experiment-0.3.0.vsix`
- `git status` — 顯示大量 `R` (rename) 而非 `D` + `A`,證明搬移走 rename 路徑

---

## 風險與緩解 (Risks & Mitigation)

| 風險 | 緩解 |
|------|-----|
| `git mv` 沒跑改用一般 mv,破壞 git rename detection | 嚴格使用 `git mv`;若誤用 `mv`,事後 `git add -A` + `git status` 檢視是否還原為 `R` 狀態 |
| `tsconfig.rootDir` 對 `log_doctor/src/extension.ts` 推算錯誤,生成路徑帶上 `../` | esbuild 自己控制 `outfile`,不走 `outDir`,不受 rootDir 影響。`tsc --noEmit` 不輸出檔案,僅型別檢查,無實際路徑問題 |
| `vitest` 把 `log_doctor/test/providers/*.test.ts` 漏掉 | include pattern `log_doctor/test/**/*.test.ts` 是 recursive,涵蓋所有子資料夾 |
| `vsce` 對 `main` 路徑解析時,把多層 `out/log_doctor/src/extension.js` 視為非法 | 已在多個 VSCode 擴充專案驗證,deep path 完全合法 |
| `out/` 舊產物殘留,新 build 把兩份都打包 | 跑 `rm -rf out/` 後再 `npm run build` 驗證 |
