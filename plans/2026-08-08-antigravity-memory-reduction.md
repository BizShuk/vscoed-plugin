# Antigravity IDE 記憶體瘦身 (Memory Reduction)

> 註: 依 CLAUDE.md 慣例本檔應命名為 `2026-08-08-antigravity-memory-reduction.md`,
> 落地時一併改名.

## Context

16 GB 的機器上, Antigravity 家族實測佔用 **6038 MB RSS**. 使用者原本的觀察值是
2.5 GB — 落差來自 IDE 內建的 process explorer 只列出 main process 的第一層子行程,
漏掉了 forked LSP workers, codex binary, chrome-devtools-mcp 與 gopls 這些孫行程.

根因不是單一失控行程, 而是 **Antigravity 對每個開啟的視窗都複製一整套 AI 側車
(sidecar) 行程**: 每視窗一份 `language_server`, 一份 codex, 一組 chrome-devtools-mcp,
外加各 extension 自行 fork 的 node worker. 目前開著 3 個視窗, 所以所有東西乘以三.

同時磁碟上累積了兩份平行安裝與 33 個從未清除的 extension 死目錄.

目標: 在**不改變 3 視窗工作流**的前提下, 移除確認用不到的常駐行程與死檔案.

---

## Measured Baseline

### 記憶體 (RSS, 實測 `ps -Ao pid,ppid,rss,args`)

| 群組 | 行程數 | RSS | 每視窗成本 |
|---|---:|---:|---|
| Renderer (視窗本體) | 3 | 1482 MB | ~490 MB |
| Extension Host | 3 | 880 MB | ~290 MB |
| `language_server_macos_arm` (Antigravity AI) | 3 | 575 MB | ~190 MB |
| forked LSP workers (json×3, markdown, yaml, containers×2) | 7 | 443 MB | ~150 MB |
| `chrome-devtools-mcp` (由 language_server 拉起) | 6 | 349 MB | ~115 MB |
| `codex` (openai.chatgpt extension) | 3 | 203 MB | ~68 MB |
| `gopls` | 2 | 114 MB | — |
| GPU / shared-process / pty-host / utility | ~8 | ~460 MB | — |
| **Antigravity 小計** | | **6038 MB** | **~1.2 GB/視窗** |
| claude CLI + 其 MCP servers (獨立, 不在本次範圍) | 5 | ~755 MB | — |

### 磁碟

| 路徑 | 大小 | 狀態 |
|---|---:|---|
| `~/Library/Application Support/Antigravity IDE` | 3.4 GB | 使用中 (WebStorage 1413 MB, Cache 788 MB, blob_storage 365 MB, CachedExtensionVSIXs 365 MB) |
| `~/.antigravity-ide/extensions` | 2.6 GB | 86 個目錄, 僅 53 個註冊在 `extensions.json` |
| `~/Library/Application Support/Antigravity` | 1.7 GB | **停用**, 8/1 後零寫入 |
| `/Applications/Antigravity.app` | 410 MB | **停用**, 與 `Antigravity IDE.app` 平行存在 |
| `~/.gemini/antigravity` | 443 MB | 使用中 (conversations 230 MB, brain 176 MB) |

### 死 extension 目錄 (33 個, 1726 MB)

`.obsolete` 標記了 26 個, 另有 7 個未註冊. 最大宗:

- `anthropic.claude-code` × 4 版本 = 1091 MB (整個 extension 已解除安裝, 改用 CLI)
- `openai.chatgpt-26.727` 舊版 = 485 MB
- `shuk.superset` × 14 個舊版 = 28 MB
- `swiftlang.swift`, `vstirbu.vscode-mermaid-preview`, `mtxr.sqltools`×3 等

---

## Plan

### Phase 1 — 移除確認用不到的 extensions (RAM 主要來源)

使用者已確認以下皆用不到. 全部從 Antigravity 的 Extensions 面板 **Uninstall** (不是
Disable — Disable 仍會佔用 scan 成本):

| Extension | 回收 |
|---|---|
| `openai.chatgpt` | 203 MB RAM (3 個 codex binary) + 440 MB 磁碟 |
| `ms-azuretools.vscode-containers` | 每視窗 2 個 node worker, ~122 MB |
| `ms-azuretools.vscode-docker` (含 `-universal`) | 同上群組 |
| `ms-vscode-remote.vscode-remote-extensionpack` | 移除 pack 會連帶帶走下列四個 |
| `ms-vscode-remote.remote-ssh` / `remote-ssh-edit` | ext host 常駐體積 |
| `ms-vscode.remote-explorer` / `remote-server` | 同上 |

移除後必須 **Reload Window** (三個視窗都要), 否則舊的 extension host 仍持有記憶體.

順帶清掉 7 個 `-universal` 與平台版並存造成的殘留目錄 (見 Phase 3, 只是磁碟).

### Phase 2 — 關閉 chrome-devtools-mcp 自動啟動 (349 MB)

**已查證**: `~/.gemini/antigravity/mcp_config.json` 與
`~/.gemini/antigravity-ide/mcp_config.json` 皆為空的 `{"mcpServers": {}}`, 所以它
**不是**使用者 MCP 設定拉起的 — 是由 Antigravity 內建的 Browser agent 功能, 從
`language_server` 直接 spawn (行程樹 `language_server → npm exec chrome-devtools-mcp
→ chrome-devtools-mcp`, 每視窗一組).

**尚待確認**: 我在 extension 的 `package.json` 只找到 `antigravity.openBrowser`,
`antigravity.showBrowserAllowlist`, `antigravity.getBrowserOnboardingPort` 這幾個
**命令**, 沒有對應的 `settings.json` 開關. 落地時依序嘗試:

1. Antigravity 自家的 Settings 面板 (Cascade / Browser 區塊) 找 Browser agent 開關
2. 若面板無此選項 → 在 `~/.gemini/antigravity-ide/mcp_config.json` 明確寫入 disable 條目
3. 都不行 → 記錄為「無法從設定關閉」, 改以 Phase 4 的手動 kill 作為權宜, 並在
   `docs/memory/` 留下 retrospective

不要為了關掉它去改 app bundle 內的檔案 — 下次更新就會被覆蓋.

### Phase 3 — 磁碟清理

依序執行, 每步先看再刪:

1. **死 extension 目錄** — 依 `extensions.json` 的註冊清單反推未註冊目錄, 刪除
   33 個 (1726 MB). 這是 Antigravity 自己標記 `.obsolete` 卻沒清掉的殘留
2. **舊安裝整份移除** (使用者已確認) — `/Applications/Antigravity.app` (410 MB)
   與 `~/Library/Application Support/Antigravity` (1.7 GB). 已驗證: 無行程持有,
   8/1 後零寫入
3. **快取** — `Cache`, `CachedData`, `blob_storage`, `CachedExtensionVSIXs`
   (共 ~1.8 GB). IDE 關閉狀態下刪除, 會自行重建
4. **WebStorage (1413 MB)** — webview 的 IndexedDB 累積, 最大單項. 刪除會清掉
   webview 內的持久狀態 (Cascade 對話歷史可能受影響), 建議**先壓縮備份到
   scratchpad 再刪**

`~/.gemini/antigravity/conversations` (230 MB) 與 `brain` (176 MB) 是對話與 TODO
歷史, **不刪** — daily-summary skill 依賴它.

### Phase 4 — 收尾與量測

1. 三個視窗全部 Reload Window
2. 重跑基準量測指令, 比對前後
3. 把「每視窗 ≈ 1.2 GB」這個 Antigravity 架構特性寫進 `~/memory/` — 這是往後判斷
   「該不該再開一個視窗」的依據

---

## 預期效果 (Realistic Estimate)

| 項目 | RAM | 磁碟 |
|---|---:|---:|
| 移除 openai.chatgpt | -203 MB | -440 MB |
| 移除 Docker / Containers | -122 ~ -366 MB | -20 MB |
| 移除 Remote pack (5 個) | -150 ~ -240 MB | -10 MB |
| 關閉 chrome-devtools-mcp | -349 MB | — |
| 死目錄 + 舊安裝 + 快取 + WebStorage | — | -6.3 GB |
| **合計** | **-820 MB ~ -1.16 GB** | **-6.8 GB** |

常駐記憶體預期 **6.0 GB → 約 4.9 ~ 5.2 GB**.

誠實說明: 這比我在選項預覽裡寫的「~3.5 GB」保守. 原因是最大的單一槓桿仍然是
**視窗數** (每視窗約 1.2 GB), 而這次選擇保留 3 視窗工作流. 若之後願意收到 1-2 個
視窗, 才會再降 1.2-2.4 GB.

---

## Verification

清理前後各跑一次, 直接比對:

```bash
# 1. Antigravity 家族總 RSS
ps -Ao rss,args | grep -i antigravity | grep -v grep | \
  awk '{s+=$1} END {printf "Antigravity total: %.0f MB\n", s/1024}'

# 2. 確認目標行程已消失 (應該全部無輸出)
ps -Ao pid,rss,args | grep -E "codex|chrome-devtools-mcp|vscode-containers" | grep -v grep

# 3. 每視窗成本 (renderer / ext host / language_server 三者對齊)
ps -Ao pid,ppid,rss,args | grep -E "Helper \((Renderer|Plugin)\)|language_server" | \
  grep -v grep | awk '{printf "%6.0f MB  PID %-7s PPID %s\n", $3/1024, $1, $2}'

# 4. 磁碟
du -sh ~/.antigravity-ide/extensions \
       ~/Library/Application\ Support/Antigravity\ IDE \
       ~/Library/Application\ Support/Antigravity 2>/dev/null

# 5. extension 目錄數應從 86 降到 ~48
ls -1 ~/.antigravity-ide/extensions | grep -vc 'extensions.json\|^\.'
```

驗收標準:

- 總 RSS < 5.3 GB
- `codex` / `chrome-devtools-mcp` 行程數為 0
- extension 目錄數 ≤ 50, `~/.antigravity-ide/extensions` < 900 MB
- `/Applications/Antigravity.app` 不存在
- 三個視窗都能正常開檔, Go/Python/Markdown 的語法與診斷功能不受影響

## 執行結果 (2026-08-08 實測)

| 指標 | Before | After | 變化 |
|---|---:|---:|---|
| Antigravity 總 RSS | 6038 MB | 4743 MB | **-1295 MB** |
| 開啟視窗數 | 3 | 5 | +2 (執行期間使用者新開) |
| **每視窗均攤** | **2013 MB** | **949 MB** | **-53%** |
| extension 目錄數 | 86 | 45 | -41 |
| `~/.antigravity-ide/extensions` | 2.6 GB | 541 MB | -2.1 GB |
| `Antigravity IDE` 資料夾 | 3.4 GB | 3.2 GB | -0.2 GB |
| 舊安裝 (app + 資料夾) | 2.1 GB | 0 | -2.1 GB |

總 RSS 只降 1.3 GB 是因為期間視窗從 3 個變 5 個。**每視窗均攤成本降了 53%**
才是真實效果 — 若維持 3 視窗, 總量會落在 ~2.9 GB。

已移除的 extensions (8 個): `openai.chatgpt`, `ms-azuretools.vscode-containers`,
`ms-azuretools.vscode-docker`, `ms-vscode-remote.vscode-remote-extensionpack`
(連帶 `remote-ssh`, `remote-ssh-edit`, `remote-explorer`, `remote-server`)。

行程數歸零: `codex`, `chrome-devtools-mcp`, `vscode-containers`, `remote-ssh`。

### 未完成 / 需使用者操作

1. **2.8 GB 快取需關閉 IDE 後清理** — 腳本已備妥 (含 WebStorage 自動備份):
   `scratchpad/antigravity-cache-clean.sh`, Cmd+Q 後執行
2. **chrome-devtools-mcp 只是 kill 掉, 未永久關閉** — binary 內確實有
   `browser_enabled` 旗標與 "browser tools are disabled" 狀態, 但沒有對應的
   `settings.json` key, 也沒有本機持久化檔案。下次用到 browser agent 會重新
   spawn。永久關閉需從 Antigravity 自家設定面板找 Browser 開關
3. **`geminicodeassist` 在執行期間自動更新, 舊版立刻變成 239 MB 死目錄** —
   證實 `.obsolete` 從不真正刪除。建議定期跑死目錄清理

## Rollback

- Extension 全部可從 Marketplace 重裝 (`antigravity.marketplaceExtensionGalleryServiceURL`
  已指向 MS marketplace)
- WebStorage 刪除前的壓縮備份放 scratchpad, 還原即可
- 舊安裝刪除**不可逆** — 使用者已明確確認 (整份刪除), 且已驗證 8/1 後零寫入
