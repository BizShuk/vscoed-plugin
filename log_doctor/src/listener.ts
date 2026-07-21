// src/listener.ts — Output Channel Listener 純邏輯模組。
// 不 import vscode,可在純 Node 直接 Vitest 測。
import { createHash } from 'node:crypto';
import type { ListenerRule } from './types';

const DEFAULT_COOLDOWN_MS = 300000;
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** 計算 dedup fingerprint:規則 id 與訊息文字的短碼。 */
export function fingerprint(rule: { id: string }, text: string): string {
  return createHash('sha1').update(`${rule.id}\n${text.trim()}`).digest('hex').slice(0, 12);
}

/** channel glob 匹配:僅支援 `*` 萬用字元,大小寫敏感。 */
function matchChannel(pattern: string, channel: string): boolean {
  if (pattern === channel) return true;
  if (!pattern.includes('*')) return false;
  // 把 glob 轉成 regex:* → .*
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(channel);
}

/** 規則是否匹配給定 payload?先比 channel glob,再比 regex。 */
export function matchRule(rule: ListenerRule, payload: { channel: string; text: string }): boolean {
  if (!matchChannel(rule.channel, payload.channel)) return false;
  // pattern 已在 loadRules 編譯,這裡直接拿 compiled
  const re = (rule as ListenerRule & { _re?: RegExp })._re;
  if (!re) return false;
  return re.test(payload.text);
}

export interface LoadRulesResult {
  rules: ListenerRule[];
  warnings: string[];
}

/** 載入並驗證 listener 規則:補預設值、編譯 regex、去重、產生警告。 */
export function loadRules(cfg: ListenerRule[]): LoadRulesResult {
  const rules: ListenerRule[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const raw of cfg) {
    if (!raw || typeof raw !== 'object') {
      warnings.push('listener rule is not an object, skipped');
      continue;
    }
    if (!raw.id || typeof raw.id !== 'string') {
      warnings.push("listener rule missing 'id', skipped");
      continue;
    }
    if (!ID_PATTERN.test(raw.id)) {
      warnings.push(`listener rule id '${raw.id}' contains illegal characters, skipped`);
      continue;
    }
    if (seenIds.has(raw.id)) {
      warnings.push(`listener rule id '${raw.id}' duplicated, skipped later occurrence`);
      continue;
    }
    if (!raw.channel || typeof raw.channel !== 'string') {
      warnings.push(`listener rule '${raw.id}' missing 'channel', skipped`);
      continue;
    }
    if (!raw.pattern || typeof raw.pattern !== 'string') {
      warnings.push(`listener rule '${raw.id}' missing 'pattern', skipped`);
      continue;
    }

    let re: RegExp;
    try {
      re = new RegExp(raw.pattern);
    } catch (e) {
      warnings.push(`listener rule '${raw.id}' has invalid regex '${raw.pattern}': ${(e as Error).message}`);
      continue;
    }

    let cooldownMs = DEFAULT_COOLDOWN_MS;
    if (raw.cooldownMs !== undefined) {
      if (typeof raw.cooldownMs !== 'number' || !Number.isFinite(raw.cooldownMs) || raw.cooldownMs < 1000) {
        warnings.push(`listener rule '${raw.id}' has invalid cooldownMs, forced to ${DEFAULT_COOLDOWN_MS}`);
      } else {
        cooldownMs = raw.cooldownMs;
      }
    }

    seenIds.add(raw.id);
    rules.push({
      ...raw,
      label: raw.label ?? raw.id,
      cooldownMs,
      _re: re,
    } as ListenerRule);
  }

  return { rules, warnings };
}

export interface DedupState {
  entries: Map<string, import('./types').DedupEntry>;
}

/** 建立空 dedup state。 */
export function newDedupState(): DedupState {
  return { entries: new Map() };
}

/** 處理一筆訊息:查 fingerprint,更新 count,必要時 evict 過期條目,回傳要寫入的 line。 */
export function applyDedup(
  state: DedupState,
  rule: ListenerRule,
  text: string,
  now: number,
): { line: import('./types').LogLineSpec; evicted: number } {
  // Evict 過期條目
  let evicted = 0;
  if (state.entries.size >= 10000) {
    const maxCooldown = Math.max(...Array.from(state.entries.values()).map((e) => e.rule.cooldownMs ?? 300000));
    for (const [fp, entry] of state.entries) {
      if (now - entry.lastSeen > maxCooldown) {
        state.entries.delete(fp);
        evicted++;
      }
    }
  }

  const fp = fingerprint(rule, text);
  const existing = state.entries.get(fp);

  if (existing && now - existing.firstSeen <= (rule.cooldownMs ?? 300000)) {
    existing.count++;
    existing.lastSeen = now;
    return {
      line: {
        channel: rule.channel,
        label: rule.label ?? rule.id,
        severity: undefined,
        text: existing.sampleText,
        count: existing.count,
      },
      evicted,
    };
  }

  // 新事件(或不命中 / 已過期)
  state.entries.set(fp, {
    fingerprint: fp,
    count: 1,
    firstSeen: now,
    lastSeen: now,
    sampleText: text,
    rule,
  });
  return {
    line: {
      channel: rule.channel,
      label: rule.label ?? rule.id,
      severity: undefined,
      text,
      count: 1,
    },
    evicted,
  };
}

/** 把 LogLineSpec 格式化為要寫入 channel 的一行。格式:[<iso>] [<severity?>] <label>@<channel>: <text>[ (×N)] */
export function formatLogLine(spec: import('./types').LogLineSpec): string {
  const ts = new Date().toISOString();
  const sev = spec.severity ? `[${spec.severity}] ` : '';
  const cnt = spec.count > 1 ? ` (×${spec.count})` : '';
  return `[${ts}] ${sev}${spec.label}@${spec.channel}: ${spec.text}${cnt}`;
}

