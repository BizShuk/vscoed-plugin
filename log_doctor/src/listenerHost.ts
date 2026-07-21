// src/listenerHost.ts — vscode 邊界:註冊 logDoctor.publish 命令,
//
// 把外部 extension 的 publish payload 透過 listener.ts 純邏輯過濾後,
// 寫入 Log Doctor channel。同源去重 + 計數。
import * as vscode from 'vscode';
import { loadRules, newDedupState, applyDedup, formatLogLine, matchRule } from './listener';
import { getReportChannel } from './report';
import type { ConfigSnapshot, PublishPayload } from './types';

const MAX_TEXT_LENGTH = 10 * 1024; // 10 KB

interface SanitizedPayload {
  payload: PublishPayload;
  /** 形狀有效但被調整時(如文字截斷)給的警告,handler 會另寫一行到 channel。 */
  warning?: string;
}

/**
 * 驗證 publish payload 形狀,並對形狀合法但過大的 text 進行截斷。
 * - 形狀錯誤 (非物件、缺欄位、型別不對):回傳 `null`,由 caller silent-drop。
 * - 形狀合法但 text > 10KB:截斷到前 10KB 並回傳 `{ payload, warning }`。
 * - 完全合法:回傳 `{ payload }`,無 warning。
 */
function validatePayload(raw: unknown): SanitizedPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<PublishPayload>;
  if (typeof p.channel !== 'string') return null;
  if (typeof p.text !== 'string') return null;
  if (p.severity !== undefined && !['info', 'warn', 'error'].includes(p.severity)) {
    return null;
  }

  let text = p.text;
  let warning: string | undefined;
  if (text.length > MAX_TEXT_LENGTH) {
    const originalLen = text.length;
    text = text.slice(0, MAX_TEXT_LENGTH);
    warning = `text truncated from ${originalLen} to ${MAX_TEXT_LENGTH} chars`;
  }

  const payload: PublishPayload = {
    channel: p.channel,
    text,
    ...(p.severity !== undefined ? { severity: p.severity } : {}),
  };
  return warning ? { payload, warning } : { payload };
}

export function activateListener(
  context: vscode.ExtensionContext,
  cfg: ConfigSnapshot,
): void {
  const { rules, warnings } = loadRules(cfg.listeners);
  const channel = getReportChannel();

  // 載入時的警告一次寫進 channel
  for (const w of warnings) {
    channel.appendLine(`[${new Date().toISOString()}] [listener] ${w}`);
  }

  const dedup = newDedupState();

  const handler = (raw: unknown): void => {
    try {
      const result = validatePayload(raw);
      if (result === null) {
        channel.appendLine(
          `[${new Date().toISOString()}] [silent-drop] invalid publish payload`,
        );
        return;
      }
      const { payload } = result;
      if (result.warning) {
        channel.appendLine(`[${new Date().toISOString()}] [listener] ${result.warning}`);
      }
      for (const rule of rules) {
        if (!matchRule(rule, payload)) continue;
        const { line } = applyDedup(dedup, rule, payload.text, Date.now());
        if (payload.severity) line.severity = payload.severity;
        channel.appendLine(formatLogLine(line));
      }
    } catch (e) {
      channel.appendLine(
        `[${new Date().toISOString()}] [silent-drop] handler error: ${(e as Error).message}`,
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('logDoctor.publish', handler),
  );
}