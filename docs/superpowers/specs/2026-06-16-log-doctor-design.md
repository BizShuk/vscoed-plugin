# Log Doctor — 設計規格 (Design Spec)

日期:2026-06-16
狀態:草案 (Draft),待使用者審閱

## 一、目標 (Goal)

`Log Doctor` 是一個 VSCode / Antigravity 擴充功能,監聽工作區的問題與錯誤訊號,
透過可切換的 AI API 供應商,以「混合策略」自動或半自動修復程式碼。

核心約束:

- 觸發為「完全手動呼叫」命令;命令本身是「掃描 + 入列」,不是「立刻全修」。
- 處理範圍為「整個工作區」。
- 套用採「混合策略」:低風險自動套用,高風險顯示 diff 由使用者確認。
- 對重複問題去重 (dedup),同根因只修一次。
- 全域硬限速:整個工具每 30 分鐘只實際套用一次修復(可設定)。
- 多供應商抽象:Claude / OpenAI / 本地模型可切換。
- 目標 IDE:VSCode 與 Antigravity(VSCode fork),以標準擴充功能 API 為主。

## 二、訊號來源 (Signal Sources)

| 來源 | 取得方式 | 可靠度 |
|------|----------|--------|
| Problems panel 診斷 | `vscode.languages.getDiagnostics()` + `onDidChangeDiagnostics` | 原生支援,核心 |
| Task 執行錯誤 | 帶 `problemMatcher` 的 task 會自動成為 diagnostics;純文字輸出為 best-effort | 經 diagnostics 可靠,純文字有限 |

已知限制:VSCode Output channel 為唯寫,無公開 API 讀取其他套件的頻道。
因此 task 錯誤主要透過 `problemMatcher` → diagnostics 取得,純文字輸出列為後續加強。

## 三、架構 (Architecture)

方案:單體擴充功能 (Monolithic extension)。全部邏輯在 extension 進程內,
以 TypeScript 實作。各模組可自由 import `vscode`,但純邏輯模組刻意不依賴 `vscode`
以利單元測試。

```
log_doctor/
  package.json          # manifest:命令、設定、activation(onStartupFinished)
  tsconfig.json
  src/
    extension.ts        # activate/deactivate、註冊命令、啟動排程器
    collector.ts        # 收集工作區 diagnostics + task 輸出
    dedup.ts            # 計算重複簽名、歸併同根因(純)
    grouper.ts          # 依檔案/嚴重度分組、排序、上限裁切(純)
    risk.ts             # 風險分類器:決定自動 vs 確認(純)
    prompt.ts           # 組 LLM 提示(純)
    providers/
      provider.ts       # Provider 介面 + factory
      claude.ts         # Anthropic SDK
      openai.ts         # OpenAI SDK
    fixer.ts            # 編排:取代表項→組提示→呼叫 provider→拿修補
    applier.ts          # WorkspaceEdit 套用;低風險自動、高風險確認
    verifier.ts         # 重新收集 diagnostics,比對 before/after,回歸還原
    queue.ts            # 持久化佇列(workspaceState):CRUD + 優先排序
    scheduler.ts        # 全域冷卻計時、序列化單一修復、重啟接續
    config.ts           # 讀設定;API 金鑰走 SecretStorage
    report.ts           # 進度與結果摘要(Output channel)
  test/
```

標記為「純」的模組(`dedup` / `grouper` / `risk` / `prompt`)不 import `vscode`,
可用 Vitest 直接測試,不需啟動 Extension Host。

## 四、命令與設定 (Commands & Settings)

命令:

- `logDoctor.fixWorkspace` → 顯示為 `Log Doctor: Fix Workspace Issues`
  - 行為:掃描全工作區 diagnostics → 去重 → 排序 → 進持久佇列 → 啟動/喚醒排程器。

設定項:

| 設定 | 預設 | 用途 |
|------|------|------|
| `logDoctor.provider` | `claude` | `claude` / `openai` |
| `logDoctor.model` | (依 provider) | 模型 ID |
| `logDoctor.autoApplySources` | `["eslint","prettier","ruff","gofmt","stylelint"]` | 視為低風險、可自動套用的 diagnostic 來源 |
| `logDoctor.autoApplyMaxLines` | `3` | 自動套用的修補行數上限 |
| `logDoctor.maxIssues` | `50` | 單次入列的 diagnostic 上限(去重後) |
| `logDoctor.cooldownMinutes` | `30` | 全域限速:兩次套用之間最短間隔 |

API 金鑰使用 VSCode `SecretStorage`,不寫進 `settings.json`,避免外洩。

## 五、執行模型與資料流 (Execution Model & Data Flow)

手動命令 =「掃描 + 入列」,排程器在背景以全域限速序列化修復。

```
手動命令 logDoctor.fixWorkspace
  → collector:getDiagnostics() 取全工作區 [uri, Diagnostic[]]
  → dedup:同簽名只留代表項
  → grouper:依嚴重度排序、裁到 maxIssues(被丟棄的會 log)
  → queue:寫入持久化佇列(workspaceState)
  → scheduler.wake()

scheduler(背景)
  → 若 距上次套用 ≥ cooldownMinutes:
        取佇列最高優先一項 → fixer → applier → verifier → 蓋時間戳
  → 否則:排 setTimeout 等冷卻結束後再取下一項

extension.activate(onStartupFinished)
  → queue.load() + 讀回上次套用時間戳
  → scheduler.resume():依已過時間決定立刻修或繼續等
```

重複簽名 (dedup signature) 定義:

```
signature = hash(diagnostic.source + 正規化(message) + diagnostic.code)
  正規化:移除變數名 / 行號 / 路徑等可變片段,使同類錯誤歸成一組
一組重複 → 只修代表項一次
  修完後重掃,若同組其他項自動消失即一起結案
```

風險分流 (混合策略):

```
低風險 → 自動套用:
  diagnostic.source ∈ autoApplySources  且  修補行數 ≤ autoApplyMaxLines
高風險 → 人工確認:
  其餘全部(型別錯誤、邏輯錯誤、跨檔修改)→ 顯示 diff,使用者接受/拒絕
冷卻時間戳僅在「實際套用」時更新,等待使用者確認期間不空轉。
```

## 六、錯誤處理 (Error Handling)

| 情況 | 處理 |
|------|------|
| 缺 API 金鑰 | 提示用 SecretStorage 設定,佇列暫停 |
| provider / 網路失敗 | 該項退回佇列(重試上限 3),冷卻不重置,記 log |
| LLM 回傳無法解析的修補 | 跳過該項、標記 failed、記 log,不蓋時間戳 |
| 套用後產生新錯誤 | verifier 偵測回歸 → 自動還原該檔(套用前已快照原文)→ 標記 failed |
| 高風險項輪到但使用者離開 | 維持 pending 等確認;時間戳在實際套用才更新 |
| 檔案過大 / 超 token | 跳過並 log,不阻塞佇列 |

重試上限為 3 次,符合全域規則;超過則停止該項並明確記錄錯誤。

## 七、驗證迴圈 (Verification Loop)

```
套用前:快照目標檔原文
套用後:等 onDidChangeDiagnostics(去抖 + 逾時保護,因 LSP 重檢為非同步)
比對:
  代表項消失 且 該檔無新增 error → 成功
  該檔出現新 error → 判定回歸 → 還原快照 → 標記 failed
  代表項仍在 → 標記 unresolved,留在佇列(計入重試上限)
```

## 八、測試策略 (Testing)

- 純模組單元測試 (Vitest):`dedup` 簽名正規化、`grouper` 排序裁切、`risk` 分流、
  `prompt` 組裝、`queue` 持久化邏輯、`scheduler` 冷卻計算。
- `providers`:mock HTTP。
- 整合測試 (`@vscode/test-electron`):fixture 工作區放已知 diagnostics,
  跑命令驗證入列 / 修復 / 驗證流程。
- 手動:Extension Development Host;`cooldownMinutes` 設為 0 可加速測試。

## 九、範圍界線 (Scope / YAGNI)

MVP 涵蓋:

- 手動命令、全工作區掃描入列、去重、全域限速、混合套用、驗證還原、Claude/OpenAI 兩供應商。

明確排除(後續):

- 背景自動偵測觸發(目前僅手動)。
- 純文字 Output channel / terminal 完整攔截(僅 problemMatcher 路徑)。
- 獨立 daemon / CLI 重用(方案 C)。
- 本地模型供應商(介面預留,先不實作)。
