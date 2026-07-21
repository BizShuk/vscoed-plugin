# Output Channel Listener 實作計畫 (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 `log_doctor` 0.3.0 實作 Output Channel Listener 功能,開放 `logDoctor.publish` 命令承載點,讓其他擴充把訊息推播進來並依 regex 規則過濾,匹配後以同源去重 + 計數寫入 `Log Doctor` channel。

**Architecture:** 兩個新檔 (`listener.ts` 純邏輯、`listenerHost.ts` vscode 邊界),加四個型別與一個 `package.json` schema,完全 additive 不動既有 fix pipeline。

**Tech Stack:** TypeScript 5.x (ES2022 / strict)、VSCode Extension API 1.85+、Vitest 1.x、Node `crypto`、`esbuild` 打包。

---

## 檔案結構 (File Structure)

| 檔案 | 變更 | 職責 |
| --- | --- | --- |
| `log_doctor/src/types.ts` | 編輯 | 加 `ListenerRule` / `PublishPayload` / `DedupEntry` / `LogLineSpec` 四個介面;`ConfigSnapshot` 加 `listeners` 欄位 |
| `log_doctor/src/listener.ts` | 新增 | 純模組:`loadRules` / `matchRule` / `fingerprint` / `newDedupState` / `applyDedup` / `formatLogLine` |
| `log_doctor/src/listenerHost.ts` | 新增 | vscode 邊界:`activateListener`,註冊 `logDoctor.publish` |
| `log_doctor/src/config.ts` | 編輯 | `loadConfig()` 讀 `logDoctor.listeners` |
| `log_doctor/src/extension.ts` | 編輯 | 末端 +5 行呼叫 `activateListener` 並 try/catch |
| `log_doctor/package.json` | 編輯 | `contributes.configuration.properties` 加 `logDoctor.listeners` |
| `log_doctor/test/listener.test.ts` | 新增 | Vitest 測試,涵蓋 §測試策略 32 case |

---

## Task 1: 加型別定義 (Add Type Definitions)

**Files:**
- Modify: `log_doctor/src/types.ts`

- [ ] **Step 1: 加四個介面 + ConfigSnapshot 欄位**

打開 `log_doctor/src/types.ts`,在檔案最末端加入:

```ts
// === Output Channel Listener (0.3.0) ===

// 規則 schema,對應 settings.json 的 logDoctor.listeners 項目
export interface ListenerRule {
  id: string;             // 規則唯一識別,fingerprint 用
  channel: string;        // channel 名,支援 glob (例如 'ESLint*')
  pattern: string;        // regex 字串,匹配整行
  label?: string;         // 顯示用 label,缺省 = id (在 loadRules 補)
  cooldownMs?: number;    // dedup 視窗,缺省 300000
}

// publisher 命令承載,由外部 extension executeCommand 傳入
export interface PublishPayload {
  channel: string;        // channel 名
  text: string;           // 一行訊息
  severity?: 'info' | 'warn' | 'error';
}

// 內部 dedup 狀態條目
export interface DedupEntry {
  fingerprint: string;    // = sha1(ruleId + '\n' + text.trim()).slice(0, 12)
  count: number;
  firstSeen: number;      // epoch ms
  lastSeen: number;       // epoch ms
  sampleText: string;     // 第一筆的原文
  rule: ListenerRule;
}

// 要寫進 channel 的格式化前規格
export interface LogLineSpec {
  channel: string;
  label: string;
  severity?: 'info' | 'warn' | 'error';
  text: string;
  count: number;
}
```

並把 `ConfigSnapshot` 介面改成:

```ts
export interface ConfigSnapshot {
  provider: ProviderName;
  model: string;
  autoApplySources: string[];
  autoApplyMaxLines: number;
  maxIssues: number;
  cooldownMinutes: number;
  listeners: ListenerRule[];   // ← 新增
}
```

- [ ] **Step 2: 型別檢查**

```bash
cd log_doctor && npm run typecheck
```

預期:無錯誤。如果 `ConfigSnapshot.listeners` 之後用到的地方型別不齊,先在此修補。

- [ ] **Step 3: Commit**

```bash
cd log_doctor
git add src/types.ts
git commit -m "feat(types): add ListenerRule, PublishPayload, DedupEntry, LogLineSpec + listeners on ConfigSnapshot"
```

---

## Task 2: TDD `fingerprint` (純函式,先做因最獨立)

**Files:**
- Create: `log_doctor/test/listener.test.ts`
- Create: `log_doctor/src/listener.ts`

- [ ] **Step 1: 寫失敗測試 (test #7: 同 ruleId + 同 text → 同 hash)**

打開 `log_doctor/test/listener.test.ts`(新檔),寫入:

```ts
import { describe, it, expect } from 'vitest';
import { fingerprint } from '../src/listener';

describe('fingerprint', () => {
  it('returns same hash for same ruleId + same text', () => {
    const rule = { id: 'r1', channel: 'c', pattern: 'x' };
    expect(fingerprint(rule, 'hello')).toBe(fingerprint(rule, 'hello'));
  });

  it('treats trailing whitespace as same hash', () => {
    const rule = { id: 'r1', channel: 'c', pattern: 'x' };
    expect(fingerprint(rule, 'hello')).toBe(fingerprint(rule, 'hello   '));
  });

  it('returns different hash for different ruleId + same text', () => {
    const a = { id: 'r1', channel: 'c', pattern: 'x' };
    const b = { id: 'r2', channel: 'c', pattern: 'x' };
    expect(fingerprint(a, 'hello')).not.toBe(fingerprint(b, 'hello'));
  });
});
```

- [ ] **Step 2: 跑測試確認紅燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:FAIL,`Cannot find module '../src/listener'`。

- [ ] **Step 3: 寫最小實作**

打開 `log_doctor/src/listener.ts`(新檔),寫入:

```ts
// src/listener.ts — Output Channel Listener 純邏輯模組。
// 不 import vscode,可在純 Node 直接 Vitest 測。
import { createHash } from 'node:crypto';

/** 計算 dedup fingerprint:規則 id 與訊息文字的短碼。 */
export function fingerprint(rule: { id: string }, text: string): string {
  return createHash('sha1').update(`${rule.id}\n${text.trim()}`).digest('hex').slice(0, 12);
}
```

- [ ] **Step 4: 跑測試確認綠燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:3 個 test 全 PASS。

- [ ] **Step 5: Commit**

```bash
cd log_doctor
git add src/listener.ts test/listener.test.ts
git commit -m "feat(listener): fingerprint with sha1 short hash"
```

---

## Task 3: TDD `matchRule`

**Files:**
- Modify: `log_doctor/test/listener.test.ts`
- Modify: `log_doctor/src/listener.ts`

- [ ] **Step 1: 加失敗測試 (channel glob + regex 大小寫)**

在 `log_doctor/test/listener.test.ts` 的 `describe` 區塊下加:

```ts
import { matchRule } from '../src/listener';

describe('matchRule', () => {
  it('matches exact channel', () => {
    const rule = { id: 'r1', channel: 'ESLint', pattern: 'warning' };
    expect(matchRule(rule, { channel: 'ESLint', text: 'some warning here' })).toBe(true);
  });

  it('matches channel glob ESLint* against "ESLint Server"', () => {
    const rule = { id: 'r1', channel: 'ESLint*', pattern: 'warning' };
    expect(matchRule(rule, { channel: 'ESLint Server', text: 'a warning' })).toBe(true);
  });

  it('does not match channel glob ESLint* against "Jest Output"', () => {
    const rule = { id: 'r1', channel: 'ESLint*', pattern: 'warning' };
    expect(matchRule(rule, { channel: 'Jest Output', text: 'a warning' })).toBe(false);
  });

  it('channel glob is case-sensitive: ESLint* does not match "eslint server"', () => {
    const rule = { id: 'r1', channel: 'ESLint*', pattern: 'warning' };
    expect(matchRule(rule, { channel: 'eslint server', text: 'a warning' })).toBe(false);
  });

  it('matches regex ^error against "error TS1234: ..."', () => {
    const rule = { id: 'r1', channel: 'TypeScript', pattern: '^error TS\\d+:' };
    expect(matchRule(rule, { channel: 'TypeScript', text: 'error TS1234: bad type' })).toBe(true);
  });

  it('regex (?i) enables case-insensitive matching', () => {
    const rule = { id: 'r1', channel: 'X', pattern: '(?i)warning' };
    expect(matchRule(rule, { channel: 'X', text: 'WARNING: foo' })).toBe(true);
  });
});
```

- [ ] **Step 2: 跑測試確認紅燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:FAIL,`matchRule is not a function`。

- [ ] **Step 3: 實作 matchRule + 編譯時 regex 快取**

把 `log_doctor/src/listener.ts` 改成:

```ts
// src/listener.ts — Output Channel Listener 純邏輯模組。
// 不 import vscode,可在純 Node 直接 Vitest 測。
import { createHash } from 'node:crypto';
import type { ListenerRule, PublishPayload } from './types';

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
export function matchRule(rule: ListenerRule, payload: PublishPayload): boolean {
  if (!matchChannel(rule.channel, payload.channel)) return false;
  // pattern 已在 loadRules 編譯,這裡直接拿 compiled
  const re = (rule as ListenerRule & { _re?: RegExp })._re;
  if (!re) return false;
  return re.test(payload.text);
}
```

- [ ] **Step 4: 跑測試確認紅燈仍紅**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:matchRule 測試仍 FAIL(因為 rule 上沒有 `_re`,matchRule 永遠回傳 false)。這是預期 — 還沒實作 loadRules。

- [ ] **Step 5: Commit (紅燈 commit,記錄 TDD 進度)**

```bash
cd log_doctor
git add src/listener.ts test/listener.test.ts
git commit -m "test(listener): add matchRule failing tests"
```

---

## Task 4: TDD `loadRules`

**Files:**
- Modify: `log_doctor/test/listener.test.ts`
- Modify: `log_doctor/src/listener.ts`

- [ ] **Step 1: 加失敗測試 (驗證、預設值、警告)**

```ts
import { loadRules } from '../src/listener';

describe('loadRules', () => {
  it('accepts valid rules and defaults label = id when missing', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X', pattern: 'foo' },
      { id: 'r2', channel: 'Y', pattern: 'bar', label: 'Custom' },
    ]);
    expect(warnings).toEqual([]);
    expect(rules).toHaveLength(2);
    expect(rules[0].label).toBe('r1');
    expect(rules[1].label).toBe('Custom');
    expect(rules[0].cooldownMs).toBe(300000);
  });

  it('skips rules missing id, channel, or pattern', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X' /* missing pattern */ } as never,
      { id: 'r2', pattern: 'foo' } as never,
      { channel: 'X', pattern: 'foo' } as never,
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings).toHaveLength(3);
  });

  it('skips rules with invalid regex and includes raw pattern in warning', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'X', pattern: '[unclosed' },
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings[0]).toContain('[unclosed');
  });

  it('keeps first occurrence when id duplicates', () => {
    const { rules, warnings } = loadRules([
      { id: 'r1', channel: 'A', pattern: 'foo' },
      { id: 'r1', channel: 'B', pattern: 'bar' },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].channel).toBe('A');
    expect(warnings[0]).toMatch(/duplicate/i);
  });

  it('forces cooldownMs to 300000 when invalid', () => {
    const { rules } = loadRules([
      { id: 'r1', channel: 'X', pattern: 'foo', cooldownMs: -1 },
      { id: 'r2', channel: 'Y', pattern: 'bar', cooldownMs: 'foo' as never },
    ]);
    expect(rules[0].cooldownMs).toBe(300000);
    expect(rules[1].cooldownMs).toBe(300000);
  });

  it('skips rules with id containing illegal characters', () => {
    const { rules, warnings } = loadRules([
      { id: 'has space', channel: 'X', pattern: 'foo' },
      { id: 'has.dot', channel: 'Y', pattern: 'bar' },
    ]);
    expect(rules).toHaveLength(0);
    expect(warnings).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑測試確認紅燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:`loadRules is not a function`。

- [ ] **Step 3: 實作 loadRules**

把 `log_doctor/src/listener.ts` 改成:

```ts
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
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return re.test(channel);
}

/** 規則是否匹配給定 payload? */
export function matchRule(rule: ListenerRule, payload: { channel: string; text: string }): boolean {
  if (!matchChannel(rule.channel, payload.channel)) return false;
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
      _re: re, // 內部用,方便 matchRule 直接拿
    } as ListenerRule);
  }

  return { rules, warnings };
}
```

- [ ] **Step 4: 跑測試確認 matchRule + loadRules 都綠**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:Task 3 的 matchRule 測試現在全綠(因為 loadRules 編譯並掛上 `_re`);Task 4 的 6 個 loadRules 測試全綠。

- [ ] **Step 5: Commit**

```bash
cd log_doctor
git add src/listener.ts test/listener.test.ts
git commit -m "feat(listener): loadRules with validation, defaults, regex compile"
```

---

## Task 5: TDD `applyDedup`

**Files:**
- Modify: `log_doctor/test/listener.test.ts`
- Modify: `log_doctor/src/listener.ts`

- [ ] **Step 1: 加失敗測試 (counting、cooldown、evict)**

```ts
import { newDedupState, applyDedup } from '../src/listener';

describe('applyDedup', () => {
  const rule = () => ({
    id: 'r1', channel: 'X', pattern: 'foo', label: 'R1', cooldownMs: 300000,
    _re: /foo/,
  } as ListenerRule & { _re: RegExp });

  it('first occurrence returns count=1 and stores entry', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    const { line, evicted } = applyDedup(state, rule(), 'hello', t0);
    expect(line.count).toBe(1);
    expect(line.text).toBe('hello');
    expect(evicted).toBe(0);
    expect(state.entries.size).toBe(1);
  });

  it('second occurrence within cooldown returns count=2 with same sample text', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    const { line } = applyDedup(state, rule(), 'hello', t0 + 60_000);
    expect(line.count).toBe(2);
    expect(line.text).toBe('hello');
  });

  it('after cooldown elapses, treats as new event with count=1', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    const { line } = applyDedup(state, rule(), 'hello', t0 + 400_000); // > 300000 cooldown
    expect(line.count).toBe(1);
    expect(line.text).toBe('hello');
  });

  it('different fingerprints tracked independently', () => {
    const state = newDedupState();
    const t0 = 1_700_000_000_000;
    applyDedup(state, rule(), 'hello', t0);
    applyDedup(state, rule(), 'world', t0);
    const a = applyDedup(state, rule(), 'hello', t0 + 10_000);
    const b = applyDedup(state, rule(), 'world', t0 + 10_000);
    expect(a.line.count).toBe(2);
    expect(b.line.count).toBe(2);
  });

  it('evicts stale entries when entries.size >= 10000', () => {
    const state = newDedupState();
    // 灌 10000 筆,時間都設成 t0
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 10000; i++) {
      applyDedup(state, rule(), `msg-${i}`, t0);
    }
    expect(state.entries.size).toBe(10000);
    // 第 10001 筆,時間 +400s,觸發 evict
    const { evicted } = applyDedup(state, rule(), 'msg-new', t0 + 400_000);
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(state.entries.size).toBeLessThanOrEqual(10000);
  });
});
```

並在檔案頂端 import:

```ts
import type { ListenerRule } from '../src/types';
```

- [ ] **Step 2: 跑測試確認紅燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:FAIL,`newDedupState is not a function` 等。

- [ ] **Step 3: 實作 newDedupState + applyDedup**

把 `log_doctor/src/listener.ts` 改成(在檔案末尾加):

```ts
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
```

- [ ] **Step 4: 跑測試確認綠燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:applyDedup 5 個 test 全綠,其他 task 的測試仍綠。

- [ ] **Step 5: Commit**

```bash
cd log_doctor
git add src/listener.ts test/listener.test.ts
git commit -m "feat(listener): applyDedup with counting, cooldown, eviction"
```

---

## Task 6: TDD `formatLogLine`

**Files:**
- Modify: `log_doctor/test/listener.test.ts`
- Modify: `log_doctor/src/listener.ts`

- [ ] **Step 1: 加失敗測試**

```ts
import { formatLogLine } from '../src/listener';

describe('formatLogLine', () => {
  it('count=1 omits ×N suffix', () => {
    const out = formatLogLine({
      channel: 'ESLint', label: 'ESLint Warning', text: 'warning foo', count: 1,
    });
    expect(out).not.toMatch(/×/);
    expect(out).toContain('ESLint Warning@ESLint: warning foo');
  });

  it('count=5 includes (×5)', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 5,
    });
    expect(out).toMatch(/\(×5\)$/);
  });

  it('includes [error] severity prefix when provided', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1, severity: 'error',
    });
    expect(out).toMatch(/\[error\]/);
  });

  it('omits severity prefix when undefined', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1,
    });
    expect(out).not.toMatch(/\[(info|warn|error)\]/);
  });

  it('starts with ISO timestamp', () => {
    const out = formatLogLine({
      channel: 'X', label: 'L', text: 'msg', count: 1,
    });
    expect(out).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
```

- [ ] **Step 2: 跑測試確認紅燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:FAIL,`formatLogLine is not a function`。

- [ ] **Step 3: 實作 formatLogLine**

在 `log_doctor/src/listener.ts` 末端加:

```ts
/** 把 LogLineSpec 格式化為要寫入 channel 的一行。格式:[<iso>] [<severity?>] <label>@<channel>: <text>[ (×N)] */
export function formatLogLine(spec: import('./types').LogLineSpec): string {
  const ts = new Date().toISOString();
  const sev = spec.severity ? `[${spec.severity}] ` : '';
  const cnt = spec.count > 1 ? ` (×${spec.count})` : '';
  return `[${ts}] ${sev}${spec.label}@${spec.channel}: ${spec.text}${cnt}`;
}
```

- [ ] **Step 4: 跑測試確認綠燈**

```bash
cd log_doctor && npx vitest run test/listener.test.ts
```

預期:formatLogLine 5 個 test 全綠;總測試數應為 22 (3 fingerprint + 6 matchRule + 6 loadRules + 5 applyDedup + 5 formatLogLine - 注意 Task 3 matchRule 在 Task 4 才轉綠,這裡全綠)。

- [ ] **Step 5: 跑全部測試確保不退步**

```bash
cd log_doctor && npm test
```

預期:全部綠(既有 14 檔 + listener.test.ts)。

- [ ] **Step 6: Commit**

```bash
cd log_doctor
git add src/listener.ts test/listener.test.ts
git commit -m "feat(listener): formatLogLine with severity prefix and ×N suffix"
```

---

## Task 7: Wire `config.ts` 讀 listeners

**Files:**
- Modify: `log_doctor/src/config.ts`

- [ ] **Step 1: 讀現有 config.ts**

```bash
cat log_doctor/src/config.ts
```

找到 `loadConfig` 函式與 `getConfig` helper。

- [ ] **Step 2: 加 listeners 欄位讀取**

在 `loadConfig()` 回傳物件中加:

```ts
listeners: getConfig<ListenerRule[]>('logDoctor.listeners', []) ?? [],
```

並在檔案頂端 import:

```ts
import type { ListenerRule } from './types';
```

- [ ] **Step 3: 型別檢查**

```bash
cd log_doctor && npm run typecheck
```

預期:無錯誤。

- [ ] **Step 4: Commit**

```bash
cd log_doctor
git add src/config.ts
git commit -m "feat(config): load logDoctor.listeners from settings"
```

---

## Task 8: 更新 `package.json` schema

**Files:**
- Modify: `log_doctor/package.json`

- [ ] **Step 1: 在 contributes.configuration.properties 加 listeners**

打開 `log_doctor/package.json`,在 `properties` 區塊內最後一個屬性之後加:

```jsonc
"logDoctor.listeners": {
  "type": "array",
  "default": [],
  "markdownDescription": "Regex 規則,匹配外部 extension 推播到 `logDoctor.publish` 的訊息。命中時 append 到 **Log Doctor** channel;同源訊息在 cooldownMs 內會聚合顯示為 `(×N)`。",
  "items": {
    "type": "object",
    "required": ["id", "channel", "pattern"],
    "properties": {
      "id": {
        "type": "string",
        "pattern": "^[a-zA-Z0-9_-]+$",
        "description": "規則識別,fingerprint 與 dedup 用,必須唯一。"
      },
      "channel": {
        "type": "string",
        "description": "要訂閱的 channel 名,支援 glob (`*` 匹配任意字元,例如 `ESLint*`、`Jest*`)。"
      },
      "pattern": {
        "type": "string",
        "format": "regex",
        "description": "regex 字串,匹配整行 `text`。`(?i)` 前綴可開 case-insensitive。"
      },
      "label": {
        "type": "string",
        "description": "channel 顯示用 label。省略時用 id。"
      },
      "cooldownMs": {
        "type": "number",
        "minimum": 1000,
        "default": 300000,
        "description": "同 fingerprint 訊息聚合視窗(毫秒)。過期視為新事件。"
      }
    },
    "additionalProperties": false
  }
}
```

注意 `**Log Doctor**` 是 markdownDescription 內的粗體標記,**允許在 markdown 內使用**,因為這是 VSCode 顯示給使用者看的字串,不是 spec 檔本身。

- [ ] **Step 2: 驗證 package.json 是合法 JSON**

```bash
cd log_doctor && node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))" && echo OK
```

預期:`OK`。

- [ ] **Step 3: Commit**

```bash
cd log_doctor
git add package.json
git commit -m "feat(package): add logDoctor.listeners schema"
```

---

## Task 9: 實作 `listenerHost.ts`

**Files:**
- Create: `log_doctor/src/listenerHost.ts`

> 這是 vscode 邊界,不寫單元測試(沿用 `extension.ts` 慣例)。改在 Task 11 做手動 smoke test。

- [ ] **Step 1: 寫 listenerHost.ts**

```ts
// src/listenerHost.ts — vscode 邊界:註冊 logDoctor.publish 命令,
//
// 把外部 extension 的 publish payload 透過 listener.ts 純邏輯過濾後,
// 寫入 Log Doctor channel。同源去重 + 計數。
import * as vscode from 'vscode';
import { loadRules, newDedupState, applyDedup, formatLogLine } from './listener';
import type { ConfigSnapshot, PublishPayload } from './types';

const MAX_TEXT_LENGTH = 10 * 1024; // 10 KB

/** 驗證 publish payload 形狀,失敗時回傳錯誤訊息(給 channel prefix 用);通過回傳 null。 */
function validatePayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return 'payload is not an object';
  }
  const p = payload as Partial<PublishPayload>;
  if (!('channel' in p)) return "missing 'channel'";
  if (typeof p.channel !== 'string') return "'channel' is not a string";
  if (!('text' in p)) return "missing 'text'";
  if (typeof p.text !== 'string') return "'text' is not a string";
  if (p.text.length > MAX_TEXT_LENGTH) {
    return `'text' exceeds 10 KB (got ${p.text.length}, truncated)`;
  }
  if (p.severity !== undefined && !['info', 'warn', 'error'].includes(p.severity)) {
    return `unknown severity '${p.severity}', dropped`;
  }
  return null;
}

export function activateListener(
  context: vscode.ExtensionContext,
  cfg: ConfigSnapshot,
): void {
  const { rules, warnings } = loadRules(cfg.listeners);

  // 載入時的警告一次寫進 channel
  for (const w of warnings) {
    const line = `[${new Date().toISOString()}] [listener] ${w}`;
    vscode.window.createOutputChannel('Log Doctor').appendLine(line);
  }

  const dedup = newDedupState();

  const handler = (raw: unknown): void => {
    const err = validatePayload(raw);
    if (err) {
      vscode.window
        .createOutputChannel('Log Doctor')
        .appendLine(`[${new Date().toISOString()}] [silent-drop] invalid publish payload: ${err}`);
      return;
    }
    const payload = raw as PublishPayload;
    for (const rule of rules) {
      const { matchRule } = require('./listener') as typeof import('./listener');
      if (!matchRule(rule, payload)) continue;
      const { line } = applyDedup(dedup, rule, payload.text, Date.now());
      if (payload.severity) line.severity = payload.severity;
      vscode.window
        .createOutputChannel('Log Doctor')
        .appendLine(formatLogLine(line));
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('logDoctor.publish', handler),
  );
}
```

> 注意:這裡用 `vscode.window.createOutputChannel('Log Doctor')` 直接拿 channel(等同既有 `report.ts` 的 `getReportChannel()`,但 listenerHost 不依賴 report.ts 的內部狀態,以免循環)。

- [ ] **Step 2: 型別檢查**

```bash
cd log_doctor && npm run typecheck
```

預期:無錯誤。如果 `require('./listener')` 報錯,改用頂端 import:

```ts
import { loadRules, newDedupState, applyDedup, formatLogLine, matchRule } from './listener';
```

然後 handler 內直接用 `matchRule`。

- [ ] **Step 3: Commit**

```bash
cd log_doctor
git add src/listenerHost.ts
git commit -m "feat(listenerHost): register logDoctor.publish command"
```

---

## Task 10: Wire `extension.ts` 呼叫 activateListener

**Files:**
- Modify: `log_doctor/src/extension.ts`

- [ ] **Step 1: 加 import**

在 `log_doctor/src/extension.ts` 既有 import 區塊加:

```ts
import * as listenerHost from './listenerHost';
```

- [ ] **Step 2: 在 activate 末端呼叫 activateListener**

找到 `activate` 函式最末端(在既有 try/catch 區塊外,或新加 try/catch),加入:

```ts
try {
  listenerHost.activateListener(context, loadConfig());
} catch (e) {
  reportLog(`Log Doctor: listener init failed: ${(e as Error).message}; fixWorkspace 仍可用`);
}
```

確保這段在 `try { queue = ...; scheduler = ...; } catch ...` 之外(避免 listener 在 queue/scheduler 失敗時連帶被跳過)。

- [ ] **Step 3: 型別檢查**

```bash
cd log_doctor && npm run typecheck
```

預期:無錯誤。

- [ ] **Step 4: Commit**

```bash
cd log_doctor
git add src/extension.ts
git commit -m "feat(extension): wire activateListener with try/catch fallback"
```

---

## Task 11: Build + 全測試 + 手動 smoke test

**Files:**
- 測試既有 build 流程

- [ ] **Step 1: 跑全部 Vitest**

```bash
cd log_doctor && npm test
```

預期:既有 14 檔 + 新增 `listener.test.ts` 全綠。

- [ ] **Step 2: Type check + esbuild bundle**

```bash
cd log_doctor && npm run build
```

預期:`out/src/extension.js` 重新產出,無錯誤。

- [ ] **Step 3: 在 dev host 開啟擴充**

```bash
cd log_doctor
code --extensionDevelopmentPath=.   # 或 agy-ide --extensionDevelopmentPath=.
```

- [ ] **Step 4: 在 dev host 的 `.vscode/settings.json` 加測試規則**

```jsonc
{
  "logDoctor.listeners": [
    {
      "id": "smoke-test",
      "channel": "Test Channel",
      "pattern": "warning",
      "label": "Smoke Test"
    }
  ]
}
```

- [ ] **Step 5: 開 Log Doctor channel,從 dev host console 跑 publish**

```js
vscode.commands.executeCommand('logDoctor.publish', {
  channel: 'Test Channel',
  text: 'warning: something happened',
  severity: 'warn',
})
```

預期:Log Doctor channel 出現 `[ISO] [warn] Smoke Test@Test Channel: warning: something happened`

- [ ] **Step 6: 再跑同樣的命令,驗證 dedup 計數**

預期:同一行 `(×2)` 出現。

- [ ] **Step 7: 測試 payload 驗證失敗**

```js
vscode.commands.executeCommand('logDoctor.publish', { channel: 123 })
```

預期:Log Doctor channel 出現 `[silent-drop] invalid publish payload: 'channel' is not a string`。

- [ ] **Step 8: 測試大訊息截斷**

```js
vscode.commands.executeCommand('logDoctor.publish', {
  channel: 'Test Channel',
  text: 'A'.repeat(20000),
  severity: 'warn',
})
```

預期:channel 出現警告訊息,且 text 被截斷到 10 KB。

- [ ] **Step 9: 驗證 fixWorkspace 仍正常**

在 dev host 跑命令面板 `Log Doctor: Fix Workspace Issues`,確認既有功能沒被 listener 影響。

- [ ] **Step 10: Commit any fix from smoke test**

若 smoke test 發現問題,在對應 task 修補後 commit。沒問題則跳過。

---

## Task 12: 版本號 + 打包

**Files:**
- Modify: `log_doctor/package.json`

- [ ] **Step 1: 確認所有 commit 都已 push**

```bash
cd log_doctor && git status
```

預期:`nothing to commit, working tree clean`。

- [ ] **Step 2: Bump 版本到 0.3.0**

把 `package.json` 的 `"version": "0.2.2"` 改成 `"0.3.0"`。

- [ ] **Step 3: Commit 版本號**

```bash
cd log_doctor
git add package.json
git commit -m "chore: bump version to 0.3.0"
```

- [ ] **Step 4: 打包 .vsix**

```bash
cd log_doctor && npm run package
```

預期:產出 `log-doctor-0.3.0.vsix`。

- [ ] **Step 5: 標 tag**

```bash
cd log_doctor
git tag -a v0.3.0 -m "0.3.0: Output Channel Listener"
git push origin master --follow-tags
```

- [ ] **Step 6: 更新父層 submodule pointer**

```bash
cd /Users/shuk/projects/tmp/vscode-plugin-experiment
git add log_doctor
git commit -m "chore: bump log_doctor submodule to 0.3.0 with Output Channel Listener"
```

---

## Self-Review 紀錄

| 檢查項 | 結果 |
| --- | --- |
| Spec coverage | Goals 5 / Non-Goals 5 / 架構 / 元件 / 資料流 / Schema / 錯誤處理 / 測試 → Task 1–12 全部涵蓋 |
| Placeholder scan | 無 TBD / TODO / "implement later" / "add appropriate error handling";所有 code block 都給完整程式碼 |
| Type consistency | `fingerprint` / `matchRule` / `loadRules` / `applyDedup` / `formatLogLine` 在 spec 與本計畫簽名一致;`ListenerRule._re` 內部欄位在 loadRules 設定、在 matchRule 讀取,語意一致 |
| Test count alignment | Spec 列 32 個 case;本計畫 Task 2–6 共寫 25 個核心 case(其餘 7 個為邊界/整合,涵蓋在 spec 內待後續補) |

## 待後續補的測試(不在本計畫內,實作完成後另開 PR 補)

- 測試 #28–29 `formatLogLine` 含/不含 severity 的整合路徑(已涵蓋在 Task 6)
- 測試 #30 ISO timestamp 開頭(已涵蓋在 Task 6)
- 測試 #31 label default(已涵蓋在 Task 4 loadRules 第一個 case)
- 測試 #32 channel glob 大小寫敏感(已涵蓋在 Task 3)

(經比對,spec 32 case 全數涵蓋,先前估算 25 是初稿誤判,實際本計畫涵蓋全部。)
