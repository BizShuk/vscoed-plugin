// log_doctor/src/register.ts — Log Doctor feature 對外註冊入口。
// 由 root src/extension.ts 在 activate() 內呼叫,負責註冊本 feature 的命令、
// listener,以及初始化 queue / scheduler。本檔不 export VSCode 的 activate/deactivate
// 契約 — 那屬於 root entry 的責任。
import * as vscode from 'vscode';
import { collectDiagnostics } from './collector';
import { groupBySignature } from './dedup';
import { sortAndCap } from './grouper';
import { loadConfig, getApiKey, setApiKey } from './config';
import { PersistentQueue } from './queue';
import { Scheduler } from './scheduler';
import { createProvider } from './providers/factory';
import { fixOne } from './fixer';
import { applyOrConfirm } from './applier';
import { verifyFix } from './verifier';
import { log as reportLog, show as reportShow } from './report';
import * as listenerHost from './listenerHost';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let queue: PersistentQueue;
let scheduler: Scheduler;

const MAX_ATTEMPTS = 3;

async function snapshotFile(fsPath: string): Promise<string> {
  return readFile(fsPath, 'utf8');
}

async function restoreFile(fsPath: string, content: string): Promise<void> {
  await writeFile(fsPath, content, 'utf8');
}

async function showDiff(_oldText: string, _newText: string, uri: string): Promise<'apply' | 'reject'> {
  // 顯示虛擬文件差異;此處用最簡單的文字對話框,實務上可用 vscode.diff
  const choice = await vscode.window.showInformationMessage(
    `Log Doctor wants to modify ${uri}. Apply?`,
    { modal: true },
    'Apply',
    'Reject',
  );
  return choice === 'Apply' ? 'apply' : 'reject';
}

async function applyEdit(edit: vscode.WorkspaceEdit): Promise<boolean> {
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) return false;
  await vscode.workspace.saveAll(false); // 儲存讓 LSP 重檢
  return true;
}

async function processOneItem(secrets: vscode.SecretStorage): Promise<boolean> {
  if (!scheduler.canRun()) {
    reportLog(`cooldown active, next run in ${Math.round(scheduler.msUntilNextRun() / 1000)}s`);
    return false;
  }
  const item = queue.peek();
  if (!item) {
    reportLog('queue empty');
    return false;
  }
  const cfg = loadConfig();
  const apiKey = await getApiKey(cfg.provider, secrets);
  if (!apiKey) {
    reportLog(
      `missing API key for ${cfg.provider}; clearing queue. ` +
        `Set key via "Log Doctor: Set API Key" then re-run fixWorkspace.`,
    );
    await queue.clear();
    // 回傳 true:本輪做了事(清空),讓外層 while 再跑一次;下次 peek 會是 empty queue 自然結束。
    return true;
  }
  const provider = createProvider(cfg, apiKey);
  await queue.update(item.id, { status: 'in_flight' });

  const { fixes, error } = await fixOne({ diagnostic: item.diagnostic, provider });
  if (fixes.length === 0) {
    reportLog(`no usable fix for ${item.id}: ${error ?? 'no proposals'}`);
    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await queue.update(item.id, { status: 'failed', lastError: error, attempts });
    } else {
      await queue.update(item.id, { status: 'pending', attempts });
    }
    return true;
  }

  const fix = fixes[0];
  const fsPath = fileURLToPath(fix.uri);
  const before = await snapshotFile(fsPath);
  const beforeDiags = collectDiagnostics(() => {
    const m = new Map<vscode.Uri, vscode.Diagnostic[]>();
    m.set(vscode.Uri.parse(fix.uri), vscode.languages.getDiagnostics(vscode.Uri.parse(fix.uri)));
    return m;
  });

  const { applied, reason } = await applyOrConfirm({
    fileText: before,
    fix,
    diagnostic: item.diagnostic.info,
    autoApplySources: cfg.autoApplySources,
    autoApplyMaxLines: cfg.autoApplyMaxLines,
    applyEdit,
    showDiffAndAsk: showDiff,
  });

  if (!applied) {
    reportLog(`fix not applied for ${item.id}: ${reason}`);
    await queue.update(item.id, { status: 'awaiting_confirmation', attempts: item.attempts + 1 });
    return true;
  }

  // 只有實際套用才推進冷卻時間戳
  await scheduler.markApplied();
  reportLog(`applied fix to ${fix.uri} for ${item.id}`);

  const verification = await verifyFix({
    representative: item.diagnostic,
    before: beforeDiags,
    fetchAfter: async () => {
      const m = new Map<vscode.Uri, vscode.Diagnostic[]>();
      m.set(vscode.Uri.parse(fix.uri), vscode.languages.getDiagnostics(vscode.Uri.parse(fix.uri)));
      return collectDiagnostics(() => m);
    },
  });

  if (verification.outcome === 'regressed') {
    reportLog(`regression detected, reverting ${fix.uri}`);
    await restoreFile(fsPath, before);
    await queue.update(item.id, { status: 'failed', lastError: 'regressed' });
  } else if (verification.outcome === 'resolved') {
    reportLog(`resolved ${item.id}`);
    await queue.update(item.id, { status: 'resolved' });
  } else {
    reportLog(`unresolved ${item.id}, will retry`);
    const attempts = item.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await queue.update(item.id, { status: 'failed', lastError: 'unresolved after retries' });
    } else {
      await queue.update(item.id, { status: 'pending', attempts });
    }
  }
  return true;
}

/**
 * Log Doctor feature 註冊入口。
 * 由 root `src/extension.ts` 在 `activate()` 內呼叫;負責:
 *  1. 註冊 `logDoctor.*` 命令
 *  2. 初始化 PersistentQueue 與 Scheduler
 *  3. 啟動 Output Channel listener (`logDoctor.publish`)
 *
 * 各步驟以獨立 try/catch 包裹,確保即使 init 失敗,已註冊的命令 (特別是
 * `showOutput`) 仍可運作 — 這對 Antigravity IDE 等 VSCode 相容 editor 至關重要,
 * 其 `workspaceState` 行為可能與 VSCode 不同,容易導致 init 拋例外。
 */
export async function registerLogDoctor(context: vscode.ExtensionContext): Promise<void> {
  // 先註冊所有命令,即使後續 init 失敗,使用者仍能跑 showOutput
  // 透過 Output channel 看到錯誤訊息。
  context.subscriptions.push(
    vscode.commands.registerCommand('logDoctor.showOutput', () => {
      // 先 append 一行確認擴充已被觸發 activate;即使 show() 因為某種原因
      // 沒把面板叫出來,也能在 Output channel 裡看到這行,作為「命令真的跑了」的證據。
      reportLog('Log Doctor: output channel opened');
      reportShow();
    }),
    vscode.commands.registerCommand('logDoctor.setApiKey', async () => {
      const cfg = loadConfig();
      const key = await vscode.window.showInputBox({
        prompt: `Enter API key for ${cfg.provider}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) {
        reportLog('setApiKey: cancelled');
        return;
      }
      await setApiKey(cfg.provider, key, context.secrets);
      reportLog(`setApiKey: stored key for ${cfg.provider}`);
    }),
    vscode.commands.registerCommand('logDoctor.fixWorkspace', async () => {
      reportLog('logDoctor.fixWorkspace invoked');
      const cfg = loadConfig();
      const all = collectDiagnostics(() => {
        const m = new Map<vscode.Uri, vscode.Diagnostic[]>();
        for (const [uri, diags] of vscode.languages.getDiagnostics()) {
          m.set(uri, diags);
        }
        return m;
      });
      const groups = groupBySignature(all);
      const items = sortAndCap(groups, cfg.maxIssues, (n) =>
        reportLog(`dropped ${n} issue(s) past cap`),
      );
      reportLog(`scan: ${all.length} raw → ${groups.length} groups → enqueue ${items.length}`);
      for (const r of items) {
        await queue.add({
          id: `${r.info.source}::${r.info.uri}::${r.info.range.start.line}::${r.info.code ?? ''}`,
          diagnostic: r,
          priority: 0,
          attempts: 0,
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      // 跑到冷卻或佇列空;cooldown 結束時自動停下,不卡住命令
      let processed = true;
      while (processed) {
        processed = await processOneItem(context.secrets);
      }
      reportShow();
    }),
  );

  // 初始化 queue 與 scheduler。try/catch 確保即使 workspaceState
  // 在 Antigravity IDE 等 VSCode 相容 editor 內行為不同,也不會讓
  // register throw 把整個擴充掛掉。
  try {
    queue = new PersistentQueue(context.workspaceState);
    queue.load();
    scheduler = new Scheduler(context.workspaceState, loadConfig().cooldownMinutes);
    reportLog('Log Doctor: activated, queue + scheduler ready');
  } catch (e) {
    reportLog(
      `Log Doctor: init failed (${(e as Error).message}); ` +
        `showOutput 仍可用,fixWorkspace 可能失敗`,
    );
  }

  // 重啟接續:若佇列還有 pending 且冷卻已過,跑完整輪。
  // 也包 try/catch 避免因 queue/scheduler 未 init 導致 throw。
  try {
    if (scheduler && queue && scheduler.canRun() && queue.peek()) {
      let processed = true;
      while (processed) {
        processed = await processOneItem(context.secrets);
      }
    }
  } catch (e) {
    reportLog(`Log Doctor: restart hook failed: ${(e as Error).message}`);
  }

  // 啟動 Output Channel listener(註冊 logDoctor.publish 命令)。
  // 獨立 try/catch:即使 queue/scheduler init 失敗,listener 仍要註冊,
  // 否則外部腳本送日誌進來時會得到 "command not found"。
  try {
    listenerHost.activateListener(context, loadConfig());
  } catch (e) {
    reportLog(`Log Doctor: listener init failed: ${(e as Error).message}; fixWorkspace 仍可用`);
  }
}