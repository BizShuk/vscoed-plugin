# log_doctor — 技術脈絡 (Technical Context)

本檔描述 `log_doctor` 這個 feature 模組的內部技術脈絡。根層結構與指令見 `../CLAUDE.md` 的「資料夾即功能」與「常用指令」段落。

## 模組對應 (Module Mapping)

`log_doctor/src/` 採純函式 + 命令承載點分層;`register.ts` 是唯一耦合 VSCode API 的檔案,其餘模組可在 vitest 中以 `vi.mock('vscode')` 隔離測試。

> 注意:`register.ts` 是 feature 對外的單一函式介面 (`registerLogDoctor(context)`),不 export VSCode 的 `activate`/`deactivate` 契約 — 那屬於 root `src/extension.ts` 的責任。

| 檔案 | 職責 |
|------|------|
| `register.ts` | Log Doctor 對外註冊入口;export `registerLogDoctor(context)`;命令註冊 (`fixWorkspace` / `setApiKey` / `showOutput` / `publish`)、DI 組裝 queue / scheduler / provider;try/catch 包裹 init 確保 showOutput 永遠可用 |
| `collector.ts` | 從 `vscode.languages.getDiagnostics` 收所有檔案的 `Diagnostic[]`,轉成內部 record |
| `grouper.ts` | 同檔同源 issue 聚合為單一修復項目,並依 `maxIssues` 上限截斷 |
| `dedup.ts` | `groupBySignature` — 用 (source + uri + line + code) 做 fingerprint 去重 |
| `queue.ts` | `PersistentQueue` — 跨重啟保存於 `context.workspaceState`,支援 `add` / `peek` / `update` / `clear` |
| `scheduler.ts` | 節流器;`canRun()` / `markApplied()` 控制「兩次實際 fix 套用」最小間隔(預設 30 分鐘) |
| `risk.ts` | 判斷 patch 是否低風險(來源於 `autoApplySources` 白名單且改動 ≤ `autoApplyMaxLines` 行) |
| `fixer.ts` | 主流程編排:`fixOne({diagnostic, provider})` → LLM 提議 fixes → 風控 → apply → verify |
| `prompt.ts` | 構造 LLM 系統提示詞;要求模型回傳 unified-diff 格式 patch |
| `providers/provider.ts` | `Provider` 介面型別 (`createCompletion(prompt) → FixProposal[]`) |
| `providers/claude.ts` | Claude API 實作 (`@anthropic-ai/sdk`) |
| `providers/openai.ts` | OpenAI API 實作 (`openai`) |
| `providers/factory.ts` | `createProvider(cfg, apiKey)` 依 `logDoctor.provider` 設定回傳對應實作 |
| `applier.ts` | `applyOrConfirm` — 高風險走 `showDiffAndAsk` 確認,低風險直接 `WorkspaceEdit` 套用 |
| `verifier.ts` | `verifyFix` — 重新跑 `vscode.languages.getDiagnostics`,判定 `resolved` / `regressed` / `unresolved` |
| `report.ts` | Output channel 報告器 (`Log Doctor` 面板) |
| `listener.ts` | regex 匹配 + 同源去重 (`sha1(ruleId + text.trim()).slice(0, 12)`) |
| `listenerHost.ts` | `logDoctor.publish` 命令承載點;其他 extension 可用 `vscode.commands.executeCommand('logDoctor.publish', payload)` 推播 |
| `config.ts` | 從 `vscode.workspace.getConfiguration` 讀取 `logDoctor.*` 設定;API key 存於 `context.secrets` |
| `types.ts` | 共用型別 (`DiagnosticRecord`、`FixProposal`、`QueueItem`、`Provider` 等) |

## 建置 (Build)

### `esbuild` 打包設定

`log_doctor` 使用 `esbuild` 把 TypeScript + 依賴 (`@anthropic-ai/sdk`、`openai`) 打包成單檔 CJS (`out/log_doctor/src/extension.js`),並把 `vscode` 標為 `external`。

| 設定       | 值           | 用途                                                                        |
| ---------- | ------------ | --------------------------------------------------------------------------- |
| `external` | `['vscode']` | 保留 Extension Host 注入的全域 API,否則會 bundle 一個 stub 導致 runtime 炸 |
| `bundle`   | `true`       | 把 `node_modules/` 內的依賴全部 inline 進單檔                               |
| `target`   | `node18`     | 對應 VSCode 1.85+ 的 Electron Node 版本                                     |

路徑配置(`../esbuild.config.mjs`):

```javascript
entryPoints: [resolve(__dirname, 'src/extension.ts')],
outfile:    resolve(__dirname, 'out/src/extension.js'),
```

### 型別檢查

`../tsconfig.json` 設定 `include: ["src/**/*", "log_doctor/src/**/*", "log_doctor/test/**/*"]`,`rootDir: "."` 使 TypeScript 把 root `src/extension.ts` 映射到 `out/src/extension.js`(雖然 tsc 為 `--noEmit`,實際輸出由 esbuild 控制)。`log_doctor/` 內的 TypeScript 仍受 `log_doctor/src/**/*` 涵蓋。

### 打包產物尺寸

- VSIX 從多 MB 降至 sub-200 KB (94% 縮減)
- 根本避免 `.vscodeignore` 排除 `node_modules/` 造成的 `Cannot find module` 啟動錯誤
- 沒有 runtime 外部依賴,安裝即用

## 測試 (Test)

`log_doctor` 有 15 個 vitest 測試檔案(包含 `test/providers/` 子資料夾)。執行 `npm test`(從 `vscode-plugin-experiment/` root 跑,vitest 透過 `include: ['log_doctor/test/**/*.test.ts']` 自動定位)。

| 測試檔案 | 對應模組 |
|---------|---------|
| `test/applier.test.ts` | `applier.ts` |
| `test/collector.test.ts` | `collector.ts` |
| `test/config.test.ts` | `config.ts` |
| `test/dedup.test.ts` | `dedup.ts` |
| `test/fixer.test.ts` | `fixer.ts` |
| `test/grouper.test.ts` | `grouper.ts` |
| `test/listener.test.ts` | `listener.ts` |
| `test/prompt.test.ts` | `prompt.ts` |
| `test/queue.test.ts` | `queue.ts` |
| `test/risk.test.ts` | `risk.ts` |
| `test/scheduler.test.ts` | `scheduler.ts` |
| `test/verifier.test.ts` | `verifier.ts` |
| `test/providers/claude.test.ts` | `providers/claude.ts` |
| `test/providers/factory.test.ts` | `providers/factory.ts` |
| `test/providers/openai.test.ts` | `providers/openai.ts` |

## Listener 同源去重演算法

`logDoctor.publish` 為對外開放的命令承載點。其他擴充功能透過 `vscode.commands.executeCommand('logDoctor.publish', payload)` 把訊息推播進來,`logDoctor.listeners` 設定的 regex 規則過濾後寫入 `Log Doctor` Output channel。同源訊息會在 `cooldownMs` 視窗內聚合顯示為 `(×N)`。

### 指紋 (Fingerprint) 公式

```
fingerprint = sha1(ruleId + '\n' + text.trim()).slice(0, 12)
```

- `ruleId` 確保「同一行文字被兩個規則匹配」會各自獨立計數
- `text.trim()` 把行尾空白差異視為同一筆
- sha1 僅作短碼用途,無安全意涵

### 冷卻 (Cooldown) 邊界

| 時刻              | 事件                  | channel 輸出                     |
| ----------------- | --------------------- | -------------------------------- |
| `T0`              | 首次同 fingerprint    | `... error message`              |
| `T0 + 60s`        | 同 fingerprint 再進來 | `... error message (×2)`         |
| `T0 + cooldownMs` | 同 fingerprint 再進來 | 視為新事件,從 `count=1` 重新計數 |

`applyDedup` 內會順手驅逐 (evict) 所有 `lastSeen < now - maxCooldown` 的條目,避免 Map 無限成長。

### 時序特性

| 屬性                        | 數值 / 說明                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| 延遲 (publish → appendLine) | 同步,單筆 < 5 毫秒 (regex + Map 查詢)                                                                 |
| 同步性                      | `registerCommand` handler 為非同步安全 (async-safe);`applyDedup` 內部 Map 操作單執行緒無需上鎖 (lock) |
| 順序保證                    | 同一 channel 內 FIFO;跨 channel 不保證                                                                |
| 重啟後行為                  | 記憶體 dedup state 清空;重啟前已收過的 fingerprint 會重新以 `count=1` 寫入                            |

### 多筆規則同時匹配

一行可能同時命中多筆規則(例如「嚴重錯誤」與「含 stack trace」兩條),每筆規則各自走一次 `applyDedup` — 因為 `ruleId` 不同,fingerprint 也不同,**channel 內可能出現兩行**。使用者若不想重複,自行避免 pattern 重疊即可。

## LLM Provider 介面

```typescript
// providers/provider.ts
export interface Provider {
  createCompletion(prompt: string): Promise<FixProposal[]>;
}

export interface FixProposal {
  uri: string;          // file:// URI
  diff: string;         // unified-diff format
  rationale: string;    // human-readable explanation
}
```

新增 provider:

1. 在 `providers/<name>.ts` 實作 `Provider` 介面
2. 在 `providers/factory.ts` 的 switch 加入新 case
3. 在 `package.json` 的 `logDoctor.provider` enum 加入新值
4. 加 `test/providers/<name>.test.ts` 驗證介面契約

## 規劃文件 (Plans)

`log_doctor/plans/` 收納此 feature 的歷史實作計畫:

| 檔案 | 內容 |
|------|------|
| `2026-06-16-log-doctor.md` | 初始 MVP 規劃 |
| `2026-06-19-log-doctor-channel-listener.md` | Channel listener 設計書 |
| `2026-06-19-log-doctor-channel-listener-impl.md` | Channel listener 實作計畫 |
| `2026-06-19-log-doctor-esbuild-bundle.md` | esbuild bundle 重構 (0.2.0) |
| `verify-log-doctor.md` | 0.3.0 驗收清單 |
