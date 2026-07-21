# 專案結構與指令 (Project Structure and Commands)

本檔定義 `vscode-plugin-experiment` 專案的開發與建置指令、`folder-as-feature` 結構慣例,以及新增插件功能模組的 SOP。

## 常用指令 (Commands)

所有指令從 `vscode-plugin-experiment/` root 執行(root 是唯一的 VSCode extension manifest 與 npm workspace 入口)。

```bash
npm install         # 安裝 root devDependencies (@types/vscode、esbuild、vitest 等)
npm run build       # tsc --noEmit (型別檢查) + esbuild bundle → out/src/extension.js
npm run package     # vsce package → vscode-plugin-experiment-0.3.0.vsix
npm test            # vitest 從 log_doctor/test/ 抓 15 個 *.test.ts 跑單元測試
npm run typecheck   # 純型別檢查,不解釋
```

### VSCode extension bundling with esbuild (esbuild 打包)

esbuild 以 root `src/extension.ts` 為入口,把 TypeScript 連同各 feature 的依賴 (例如 `log_doctor` 的 `@anthropic-ai/sdk`、`openai`) 打包成單檔 CJS (`out/src/extension.js`),並把 `vscode` 標為 `external` (Extension Host runtime 注入)。好處:

- VSIX 從多 MB 降到 sub-200 KB (94% 縮減)
- 根本避免 `.vscodeignore` 排除 `node_modules/` 造成的 `Cannot find module` 啟動錯誤
- 沒有 runtime 外部依賴,安裝即用

`esbuild` 設定關鍵三項:

| 設定       | 值           | 用途                                                                        |
| ---------- | ------------ | --------------------------------------------------------------------------- |
| `external` | `['vscode']` | 保留 Extension Host 注入的全域 API,否則會 bundle 一個 stub 導致 runtime 炸 |
| `bundle`   | `true`       | 把 `node_modules/` 內的依賴全部 inline 進單檔                               |
| `target`   | `node18`     | 對應 VSCode 1.85+ 的 Electron Node 版本                                     |

參考實作: [esbuild.config.mjs](./esbuild.config.mjs)。更多 esbuild + dedup 演算法細節見 [log_doctor/CLAUDE.md](./log_doctor/CLAUDE.md) 的 `建置` 與 `Listener 同源去重演算法` 段落。

---

## 資料夾即功能 (Folder-as-Feature)

本專案的擴充策略是「**單一 VSCode extension,多個功能模組**」 — root `package.json` 作為唯一的 VSCode extension manifest 與 npm 入口,root `src/extension.ts` 作為唯一的 Extension Host 進入點 (orchestrator)。每個功能模組透過 sibling 子資料夾組織,實作細節 (`src/`、`test/`、`plans/`、`CLAUDE.md`) 全部封裝在該子資料夾內,並透過 `register*` 函式被 root entry 呼叫。

設計原則:

1. **root 是主體,子資料夾是 sub-feature** — `package.json` 的 `name` 是 `vscode-plugin-experiment`,所有 extension metadata (publisher、activationEvents、contributes) 都屬於 root;`log_doctor/` 等子資料夾只是「住在同一個 extension 內的功能模組」
2. **每個子資料夾 = 一個獨立功能模組** — `log_doctor/` 目前是唯一的功能模組,未來新增格式器、snippet 管理器等都以 sibling 形式新增,各模組 export 自己的 `register<Name>(context)` 函式
3. **root 持有 build infra** — `package.json` (extension manifest)、`src/extension.ts` (orchestrator)、`tsconfig.json`、`esbuild.config.mjs`、`vitest.config.ts` 都在 root,所有 feature 共用同一份建置設定,但 `include` 路徑需隨之更新
4. **feature 內部自給自足** — 每個 feature 內的 `src/`、`test/`、`plans/`、`CLAUDE.md` 構成完整的單元,移除時可以整包刪除而不影響其他 feature
5. **跨 feature 文件留在 root** — `plans/` (跨模組規劃)、`docs/` (跨模組設計)、`README.md` (專案總覽) 都留在 root

## 專案結構樹 (Project Tree)

```
vscode-plugin-experiment/
├── README.md                 # 專案總覽 (打包/安裝/發佈流程)
├── CLAUDE.md                 # 技術脈絡 (本檔)
├── package.json              # root VSCode extension manifest + npm 入口
├── src/                      # root Extension Host 進入點 (orchestrator)
│   └── extension.ts          # export activate/deactivate;呼叫各 feature 的 register*
├── tsconfig.json             # include: src/**, log_doctor/src/**, log_doctor/test/**
├── esbuild.config.mjs        # entryPoints: src/extension.ts
├── vitest.config.ts          # include: log_doctor/test/**/*.test.ts
├── .vscodeignore             # 排除 test/、docs/、plans/、build artifacts
│
├── docs/                     # 跨模組設計文件 (如 superpowers/)
├── plans/                    # 跨模組規劃文件 (預留,目前為空)
│
└── log_doctor/               # [Plugin Feature 1] LLM 自動修復診斷 (sub-feature)
    ├── CLAUDE.md             # log_doctor 內部技術脈絡
    ├── src/                  # 原始碼 (15 個 .ts + providers/ 子資料夾)
    │   ├── register.ts       # 對外註冊入口:registerLogDoctor(context)
    │   ├── listener.ts       # regex 匹配 + 同源去重
    │   ├── listenerHost.ts   # logDoctor.publish 命令承載點
    │   ├── report.ts         # Output channel 報告器
    │   ├── providers/        # LLM provider 實作 (claude / openai / factory)
    │   └── ...               # 收集、風控、修補、驗證模組
    ├── test/                 # Vitest 測試 (15 檔案 / 對應每個 src 模組)
    └── plans/                # log_doctor 規劃文件 (5 個歷史計畫)
```

## 插件功能測試索引 (Plugin Feature Index)

| # | 插件名稱 | 子資料夾 | 功能描述 | 狀態 |
|---|----------|---------|---------|------|
| 1 | Log Doctor | `log_doctor/` | 讀取 VSCode 診斷,以 LLM 自動修復 | ✅ Active (0.3.0) |

> 未來新插件功能測試以此格式擴充,見下方 SOP。

---

## 新增插件功能模組 (Add a New Feature Module)

新增一個 sibling 功能模組(假設命名為 `<feature_name>`)時,依以下 SOP 執行。**所有動作都基於 folder-as-feature 原則,新功能獨立於 `log_doctor/` 之外,不互相耦合。**

### Step 1: 建立子資料夾骨架

```bash
cd /Users/shuk/projects/playground/vscode-plugin-experiment
mkdir -p <feature_name>/src <feature_name>/test <feature_name>/plans
```

(可選) 建立 feature 專屬 `CLAUDE.md`:

```bash
touch <feature_name>/CLAUDE.md
```

### Step 2: 實作對外註冊入口

在 `<feature_name>/src/register.ts` 建立 feature 對外註冊函式,**只 export 一個 `register<Name>(context)` 函式**,不 export VSCode 的 `activate`/`deactivate` 契約(那屬於 root)。若 init 需要 await,函式簽章用 `Promise<void>`:

```typescript
// <feature_name>/src/register.ts
import * as vscode from 'vscode';

export async function register<Name>(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    vscode.commands.registerCommand('<feature_name>.<action>', async () => {
      // your logic — 可 await (例如 scheduler、queue 初始化)
    }),
  );
}
```

其餘程式碼放在 `<feature_name>/src/` 其他模組,在 `<feature_name>/test/` 補上對應的 `*.test.ts`。

### Step 3: 接到 root orchestrator

編輯 root `src/extension.ts`,加入 import 與呼叫:

```typescript
import { register<Name> } from '../<feature_name>/src/register';

export async function activate(context: vscode.ExtensionContext) {
  await registerLogDoctor(context);
  await register<Name>(context);  // 新 feature 在此註冊
  // ...
}
```

> 不要在 root `src/extension.ts` 內放任何 feature 邏輯 — 那會破壞 folder-as-feature 的隔離。

### Step 4: 註冊到 VSCode extension manifest

編輯 root `package.json`:

- `main` — **不需要改**,固定為 `./out/src/extension.js`
- `activationEvents` — 加入 `onCommand:<feature_name>.<action>`
- `contributes.commands` — 加入對應命令標題
- `contributes.configuration` — 若有 feature 專屬設定,在 `properties` 加 `<feature_name>.*`

### Step 5: 更新 root 建置設定 include

`tsconfig.json`:

```diff
-  "include": ["src/**/*", "log_doctor/src/**/*", "log_doctor/test/**/*"],
+  "include": ["src/**/*", "log_doctor/src/**/*", "log_doctor/test/**/*", "<feature_name>/src/**/*", "<feature_name>/test/**/*"],
```

`vitest.config.ts`:

```diff
-    include: ['log_doctor/test/**/*.test.ts'],
+    include: ['log_doctor/test/**/*.test.ts', '<feature_name>/test/**/*.test.ts'],
```

`esbuild.config.mjs` **不需要改** — 單一 entry point (`src/extension.ts`),所有 feature 的程式碼在 bundling 時被遞歸 inline 進 `out/src/extension.js`。

### Step 6: 更新文件

- 本檔「插件功能測試索引」表格 — 新增一行
- `README.md` — 若需要,在「專案結構」段落加入新 feature 描述
- `<feature_name>/CLAUDE.md` — 收納 feature 內部技術脈絡(若無則免)
- `<feature_name>/plans/` — 規劃文件存放

### Step 7: 驗證

```bash
npm run typecheck   # tsc 應能編譯新 feature 的程式碼
npm test            # vitest 應能跑到新 feature 的測試
npm run build       # esbuild 從 src/extension.ts bundle 應包含新 feature
npm run package     # vsce 應能產出包含新功能命令的 VSIX
```

---

## 注意事項 (Caveats)

- `.vscodeignore` 已忽略 `test/`、`docs/`、`plans/`、`*.test.ts` 等 pattern,搬到 `<feature_name>/test/` 等子資料夾後仍會被正確排除
- `out/` 為 build 產物,不要 commit(`.gitignore` 應已涵蓋,若無請補)
- root `package.json` 的 `publisher`、`name`、`version` 決定整個 extension 的識別 — 子資料夾不應自行宣告這些欄位,避免 vsce 打包衝突