# Log Doctor 實作計畫 (Implementation Plan)

> `For agentic workers:` REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

`目標 (Goal):` 實作一個 VSCode / Antigravity 擴充功能,手動命令觸發後掃描工作區 diagnostics,經去重 / 排序後入列,由 LLM 修復,低風險自動套用、高風險顯示 diff 由使用者確認,全程受全域冷卻限速。

`架構 (Architecture):` 單體擴充功能 (monolithic extension),全部邏輯在 extension 進程內以 TypeScript 實作。純模組 (dedup / grouper / risk / prompt) 不依賴 `vscode`,可用 Vitest 直接測試;其餘模組以 `vi.mock('vscode')` 隔離測試。

`技術棧 (Tech Stack):`
- TypeScript 5.x + `@types/vscode`
- Vitest (單元測試)
- `@vscode/test-electron` (整合測試)
- `@anthropic-ai/sdk` (Claude provider)
- `openai` (OpenAI provider)
- `vsce` (打包)

---

## 檔案總覽 (File Structure)

```
log_doctor/
  package.json                      # manifest:命令、設定、activation
  tsconfig.json                     # strict TS 設定
  vitest.config.ts                  # 測試設定
  .vscodeignore                     # 打包排除
  README.md                         # 使用說明
  src/
    types.ts                        # 共用型別 (Severity, DiagnosticInfo, QueueItem, ...)
    config.ts                       # 設定 + SecretStorage
    collector.ts                    # getDiagnostics → DiagnosticInfo[]
    dedup.ts                        # 純:簽名正規化 + 分組
    grouper.ts                      # 純:排序 + 裁切到 maxIssues
    risk.ts                         # 純:風險分流 (含修補行數後驗)
    prompt.ts                       # 純:組 LLM 提示
    queue.ts                        # workspaceState 持久化佇列
    scheduler.ts                    # 全域冷卻 + 序列化修復
    fixer.ts                        # 編排:取代表項→組提示→呼叫 provider
    applier.ts                      # WorkspaceEdit 套用 / 顯示 diff
    verifier.ts                     # 重收 diagnostics,比對,回歸還原
    report.ts                       # Output channel 摘要
    extension.ts                    # activate / deactivate / 註冊命令
    providers/
      provider.ts                   # Provider 介面
      claude.ts                     # Anthropic SDK
      openai.ts                     # OpenAI SDK
      factory.ts                    # 依設定挑 provider
  test/
    dedup.test.ts
    grouper.test.ts
    risk.test.ts
    prompt.test.ts
    queue.test.ts
    scheduler.test.ts
    providers/
      claude.test.ts
      openai.test.ts
      factory.test.ts
    fixer.test.ts
    applier.test.ts
    verifier.test.ts
    extension.test.ts
```

---

## Phase 1: 專案骨架 (Project Skeleton)

### Task 1: 初始化 package.json

`Files:`
- Create: `package.json`

- [ ] `Step 1: 建立 package.json

```json
{
  "name": "log-doctor",
  "displayName": "Log Doctor",
  "description": "Scan workspace diagnostics and fix them with a configurable LLM provider, mixed auto/confirm strategy.",
  "version": "0.1.0",
  "publisher": "local",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "logDoctor.fixWorkspace",
        "title": "Log Doctor: Fix Workspace Issues"
      },
      {
        "command": "logDoctor.setApiKey",
        "title": "Log Doctor: Set API Key"
      }
    ],
    "configuration": {
      "title": "Log Doctor",
      "properties": {
        "logDoctor.provider": {
          "type": "string",
          "enum": ["claude", "openai"],
          "default": "claude",
          "description": "Which LLM provider to call."
        },
        "logDoctor.model": {
          "type": "string",
          "default": "claude-sonnet-4-6",
          "description": "Model ID passed to the provider. Defaults to a reasonable Claude model; override for OpenAI."
        },
        "logDoctor.autoApplySources": {
          "type": "array",
          "items": { "type": "string" },
          "default": ["eslint", "prettier", "ruff", "gofmt", "stylelint"],
          "description": "Diagnostic sources treated as low-risk and eligible for auto-apply."
        },
        "logDoctor.autoApplyMaxLines": {
          "type": "number",
          "default": 3,
          "description": "Maximum lines a low-risk patch may add/remove; patches beyond this need confirmation."
        },
        "logDoctor.maxIssues": {
          "type": "number",
          "default": 50,
          "description": "Maximum number of representative diagnostics enqueued per scan."
        },
        "logDoctor.cooldownMinutes": {
          "type": "number",
          "default": 30,
          "description": "Minimum minutes between two actual fix applications."
        }
      }
    }
  },
  "scripts": {
    "build": "tsc -p .",
    "watch": "tsc -p . --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "package": "vsce package",
    "lint": "tsc -p . --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/vscode": "^1.85.0",
    "@vscode/test-electron": "^2.3.0",
    "typescript": "^5.4.0",
    "vitest": "^1.4.0",
    "vsce": "^2.15.0"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "openai": "^4.40.0"
  }
}
```

- [ ] `Step 2: 安裝依賴

Run: `cd /Users/shuk/projects/log_doctor && npm install`
Expected: `node_modules/` 出現,沒有 npm error。

- [ ] `Step 3: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add package.json package-lock.json
git commit -m "chore: initialize package.json with deps and manifest"
```

---

### Task 2: 設定 TypeScript 與 Vitest

`Files:`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`

- [ ] `Step 1: 建立 tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2022"],
    "outDir": "out",
    "rootDir": ".",
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "declaration": false
  },
  "include": ["src/**/*", "test/**/*"],
  "exclude": ["node_modules", "out", ".vscode-test"]
}
```

- [ ] `Step 2: 建立 vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/extension.ts', 'src/providers/factory.ts'],
    },
  },
});
```

- [ ] `Step 3: 建立 .vscodeignore

```
.vscode-test/
node_modules/
out/
test/
vitest.config.ts
tsconfig.json
*.map
```

- [ ] `Step 4: 確認型別檢查能跑

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤(目前還沒有 src,可手動加個空 src/extension.ts 再跑,或忽略空結果)。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add tsconfig.json vitest.config.ts .vscodeignore
git commit -m "chore: add TypeScript and Vitest configuration"
```

---

## Phase 2: 共用型別 (Shared Types)

### Task 3: 定義型別

`Files:`
- Create: `src/types.ts`

- [ ] `Step 1: 建立 types.ts

```ts
// src/types.ts — 集中所有跨模組型別。

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export type RiskLevel = 'low' | 'high';

export type ProviderName = 'claude' | 'openai';

export interface DiagnosticPosition {
  line: number;       // 0-based
  character: number;  // 0-based
}

export interface DiagnosticRange {
  start: DiagnosticPosition;
  end: DiagnosticPosition;
}

export interface DiagnosticInfo {
  uri: string;                        // 絕對檔案路徑 (file:// or on-disk path)
  source: string;                     // 例: "eslint", "tsc"
  code?: string | number;
  message: string;
  severity: Severity;
  range: DiagnosticRange;
  /** 原始 vscode.Diagnostic,需要 raw 欄位時使用;測試可塞 mock。 */
  raw?: unknown;
}

export interface RepresentativeDiagnostic {
  info: DiagnosticInfo;     // 代表項
  groupSize: number;        // 重複總數 (含代表項)
  groupUris: string[];      // 同組其他 uri
}

export interface FixProposal {
  uri: string;              // 目標檔案
  oldText: string;          // 必須在檔案內精確出現
  newText: string;          // 替換內容
  rationale?: string;       // LLM 給的理由
}

export type QueueItemStatus =
  | 'pending'
  | 'in_flight'
  | 'awaiting_confirmation'
  | 'failed'
  | 'resolved';

export interface QueueItem {
  id: string;                                  // uuid 或 hash(rep info)
  diagnostic: RepresentativeDiagnostic;
  priority: number;                            // 0 = 最高
  attempts: number;
  status: QueueItemStatus;
  riskLevel?: RiskLevel;
  lastError?: string;
  createdAt: number;                           // epoch ms
  updatedAt: number;                           // epoch ms
}

export interface ConfigSnapshot {
  provider: ProviderName;
  model: string;
  autoApplySources: string[];
  autoApplyMaxLines: number;
  maxIssues: number;
  cooldownMinutes: number;
}
```

- [ ] `Step 2: 確認 tsc 編譯

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤。

- [ ] `Step 3: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/types.ts
git commit -m "feat(types): define shared diagnostic, queue, and config types"
```

---

## Phase 3: 純邏輯模組 (Pure Logic, TDD)

> 純模組不 import `vscode`,可單獨測試。先寫測試,再實作。

### Task 4: dedup.ts — 簽名正規化與分組

`Files:`
- Create: `src/dedup.ts`
- Test: `test/dedup.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/dedup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signatureOf, groupBySignature, pickRepresentative } from '../src/dedup';
import { DiagnosticInfo } from '../src/types';

function diag(over: Partial<DiagnosticInfo>): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used. (no-unused-vars)",
    severity: 'warning',
    range: {
      start: { line: 4, character: 0 },
      end: { line: 4, character: 3 },
    },
    ...over,
  };
}

describe('signatureOf', () => {
  it('strips variable names in single quotes', () => {
    const a = diag({ message: "Variable 'foo' is defined but never used." });
    const b = diag({ message: "Variable 'bar' is defined but never used." });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips file paths', () => {
    const a = diag({ message: 'Error at /Users/x/project/a.ts:12' });
    const b = diag({ message: 'Error at /Users/y/project/b.ts:99' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips line:col markers', () => {
    const a = diag({ message: 'fail at 12:5' });
    const b = diag({ message: 'fail at 7:1' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('strips hex addresses and large numbers', () => {
    const a = diag({ message: 'ptr 0xdeadbeef offset 1234567' });
    const b = diag({ message: 'ptr 0xcafebabe offset 7654321' });
    expect(signatureOf(a)).toBe(signatureOf(b));
  });

  it('uses source + code as part of signature', () => {
    const a = diag({ source: 'eslint', code: 'no-unused-vars' });
    const b = diag({ source: 'eslint', code: 'no-undef' });
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });

  it('uses source alone when code is missing', () => {
    const a = diag({ source: 'eslint', code: undefined });
    const b = diag({ source: 'tsc', code: undefined });
    expect(signatureOf(a)).not.toBe(signatureOf(b));
  });
});

describe('groupBySignature', () => {
  it('groups diagnostics with identical signatures', () => {
    const list: DiagnosticInfo[] = [
      diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" }),
      diag({ uri: 'file:///b.ts', message: "Variable 'bar' unused" }),
      diag({ uri: 'file:///c.ts', message: "Variable 'baz' unused" }),
    ];
    const groups = groupBySignature(list);
    expect(groups).toHaveLength(1);
    expect(groups[0].groupSize).toBe(3);
    expect(groups[0].groupUris.sort()).toEqual(['file:///a.ts', 'file:///b.ts', 'file:///c.ts']);
  });

  it('keeps different signatures in different groups', () => {
    const list: DiagnosticInfo[] = [
      diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" }),
      diag({ uri: 'file:///a.ts', message: "Variable 'bar' is not defined" }),
    ];
    const groups = groupBySignature(list);
    expect(groups).toHaveLength(2);
  });
});

describe('pickRepresentative', () => {
  it('returns the first item as representative with extras in groupUris', () => {
    const a = diag({ uri: 'file:///a.ts', message: "Variable 'foo' unused" });
    const b = diag({ uri: 'file:///b.ts', message: "Variable 'bar' unused" });
    const rep = pickRepresentative([a, b]);
    expect(rep.info).toBe(a);
    expect(rep.groupSize).toBe(2);
    expect(rep.groupUris).toEqual(['file:///b.ts']);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/dedup.test.ts`
Expected: 測試失敗,出現 `Cannot find module '../src/dedup'` 或類似錯誤。

- [ ] `Step 3: 實作 dedup.ts

`src/dedup.ts`:

```ts
// src/dedup.ts — 純邏輯,計算每個 diagnostic 的正規化簽名並分組。
import { createHash } from 'node:crypto';
import { DiagnosticInfo, RepresentativeDiagnostic } from './types';

/** 把 diagnostic 訊息裡會變動的片段去掉,只留下根因樣貌。 */
export function normalizeMessage(message: string): string {
  return message
    // 單引號 / 雙引號 / 反引號 包住的識別字 → <ID>
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '<ID>')
    // Unix / Windows 絕對路徑
    .replace(/\/(?:Users|home|var|tmp|opt|etc)\/[^\s:]+/g, '<PATH>')
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+/g, '<PATH>')
    // 行:列
    .replace(/\b\d+:\d+\b/g, '<LN>')
    // 行號單獨出現
    .replace(/\bline\s+\d+\b/gi, 'line <N>')
    // 0x 開頭的十六進位
    .replace(/0x[0-9a-fA-F]+/g, '<HEX>')
    // 大型數字
    .replace(/\b\d{4,}\b/g, '<NUM>')
    // 收斂空白
    .replace(/\s+/g, ' ')
    .trim();
}

/** 計算簽名 = hash(source + 正規化訊息 + code)。 */
export function signatureOf(d: DiagnosticInfo): string {
  const payload = JSON.stringify({
    source: d.source,
    msg: normalizeMessage(d.message),
    code: d.code ?? null,
  });
  return createHash('sha1').update(payload).digest('hex');
}

/** 把同簽名的 diagnostic 合成一個代表項。 */
export function groupBySignature(list: DiagnosticInfo[]): RepresentativeDiagnostic[] {
  const buckets = new Map<string, DiagnosticInfo[]>();
  for (const d of list) {
    const sig = signatureOf(d);
    const arr = buckets.get(sig) ?? [];
    arr.push(d);
    buckets.set(sig, arr);
  }
  return Array.from(buckets.values()).map(pickRepresentative);
}

/** 從一組同簽名的 diagnostic 挑代表項 (第一個當代表,其他列為同組成員)。 */
export function pickRepresentative(group: DiagnosticInfo[]): RepresentativeDiagnostic {
  if (group.length === 0) {
    throw new Error('pickRepresentative: empty group');
  }
  const [head, ...rest] = group;
  return {
    info: head,
    groupSize: group.length,
    groupUris: rest.map((d) => d.uri),
  };
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/dedup.test.ts`
Expected: 全部測試通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/dedup.ts test/dedup.test.ts
git commit -m "feat(dedup): signature normalization and grouping with TDD"
```

---

### Task 5: grouper.ts — 排序與裁切

`Files:`
- Create: `src/grouper.ts`
- Test: `test/grouper.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/grouper.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sortAndCap } from '../src/grouper';
import { RepresentativeDiagnostic } from '../src/types';

function rep(uri: string, severity: 'error' | 'warning' | 'info' | 'hint'): RepresentativeDiagnostic {
  return {
    info: {
      uri,
      source: 'eslint',
      message: 'x',
      severity,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
    groupSize: 1,
    groupUris: [],
  };
}

describe('sortAndCap', () => {
  it('sorts error before warning before info before hint', () => {
    const list = [rep('a', 'hint'), rep('b', 'error'), rep('c', 'info'), rep('d', 'warning')];
    const out = sortAndCap(list, 10, () => {});
    expect(out.map((r) => r.info.severity)).toEqual(['error', 'warning', 'info', 'hint']);
  });

  it('caps to maxIssues and reports the count of dropped items', () => {
    const list = Array.from({ length: 5 }, (_, i) => rep(`u${i}`, 'error'));
    let dropped = 0;
    const out = sortAndCap(list, 3, (n) => (dropped = n));
    expect(out).toHaveLength(3);
    expect(dropped).toBe(2);
  });

  it('does not drop when list <= cap', () => {
    const list = [rep('a', 'error'), rep('b', 'warning')];
    let dropped = -1;
    sortAndCap(list, 10, (n) => (dropped = n));
    expect(dropped).toBe(0);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/grouper.test.ts`
Expected: 失敗,`Cannot find module '../src/grouper'`。

- [ ] `Step 3: 實作 grouper.ts

`src/grouper.ts`:

```ts
// src/grouper.ts — 純邏輯,排序 + 裁切。
import { RepresentativeDiagnostic, Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/
 * 依嚴重度排序,裁切到 maxIssues。被丟棄的數量透過 onDropped 回報 (給 report 模組記 log)。
 */
export function sortAndCap(
  list: RepresentativeDiagnostic[],
  maxIssues: number,
  onDropped: (droppedCount: number) => void,
): RepresentativeDiagnostic[] {
  const sorted = [...list].sort((a, b) => {
    const ra = SEVERITY_RANK[a.info.severity];
    const rb = SEVERITY_RANK[b.info.severity];
    if (ra !== rb) return ra - rb;
    // 同嚴重度:代表項 groupSize 大的優先 (一次修掉比較多)
    return b.groupSize - a.groupSize;
  });

  if (sorted.length <= maxIssues) {
    onDropped(0);
    return sorted;
  }
  const dropped = sorted.length - maxIssues;
  onDropped(dropped);
  return sorted.slice(0, maxIssues);
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/grouper.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/grouper.ts test/grouper.test.ts
git commit -m "feat(grouper): severity-first sort with cap and drop reporting"
```

---

### Task 6: risk.ts — 風險分流

`Files:`
- Create: `src/risk.ts`
- Test: `test/risk.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/risk.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyBySource, patchLineCount, decideRisk } from '../src/risk';
import { DiagnosticInfo, FixProposal } from '../src/types';

function diag(source: string): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source,
    message: 'x',
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  };
}

describe('classifyBySource', () => {
  it('returns low when source in autoApplySources', () => {
    expect(classifyBySource(diag('eslint'), ['eslint', 'prettier'])).toBe('low');
  });

  it('returns high when source not in autoApplySources', () => {
    expect(classifyBySource(diag('tsc'), ['eslint'])).toBe('high');
  });

  it('matches case-insensitively', () => {
    expect(classifyBySource(diag('ESLint'), ['eslint'])).toBe('low');
  });
});

describe('patchLineCount', () => {
  it('returns added line count for simple replace', () => {
    const fix: FixProposal = { uri: 'u', oldText: 'a', newText: 'b' };
    expect(patchLineCount(fix)).toBe(0);
  });

  it('counts newlines in newText minus newlines in oldText, floored at 0', () => {
    const fix: FixProposal = {
      uri: 'u',
      oldText: 'const x = 1;',
      newText: 'const x = 1;\nconst y = 2;\nconst z = 3;',
    };
    expect(patchLineCount(fix)).toBe(2);
  });

  it('returns 0 if patch removes lines', () => {
    const fix: FixProposal = {
      uri: 'u',
      oldText: 'a\nb\nc',
      newText: 'a',
    };
    expect(patchLineCount(fix)).toBe(0);
  });
});

describe('decideRisk', () => {
  it('low if source is auto and patch under threshold', () => {
    expect(decideRisk(diag('eslint'), { uri: 'u', oldText: 'a', newText: 'b' }, ['eslint'], 3)).toBe('low');
  });

  it('high if source is auto but patch exceeds threshold', () => {
    const big: FixProposal = {
      uri: 'u',
      oldText: 'a',
      newText: '1\n2\n3\n4\n5',
    };
    expect(decideRisk(diag('eslint'), big, ['eslint'], 3)).toBe('high');
  });

  it('high if source is not auto regardless of size', () => {
    expect(decideRisk(diag('tsc'), { uri: 'u', oldText: 'a', newText: 'b' }, ['eslint'], 3)).toBe('high');
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/risk.test.ts`
Expected: 失敗,`Cannot find module '../src/risk'`。

- [ ] `Step 3: 實作 risk.ts

`src/risk.ts`:

```ts
// src/risk.ts — 純邏輯,風險分流。
import { DiagnosticInfo, FixProposal, RiskLevel } from './types';

/** 依 diagnostic.source 預測風險 (不需 LLM 修補就能給出預測值)。 */
export function classifyBySource(d: DiagnosticInfo, autoApplySources: string[]): RiskLevel {
  const lowered = d.source.toLowerCase();
  return autoApplySources.some((s) => s.toLowerCase() === lowered) ? 'low' : 'high';
}

/** 計算修補的「淨新增行數」,作為是否過大的判斷。 */
export function patchLineCount(fix: FixProposal): number {
  const oldLines = fix.oldText.split('\n').length - 1;
  const newLines = fix.newText.split('\n').length - 1;
  return Math.max(0, newLines - oldLines);
}

/
 * 完整分流:source 必須是 auto,且淨新增行數 <= 門檻,才算 low。
 * 任何一條不符都升為 high。
 */
export function decideRisk(
  d: DiagnosticInfo,
  fix: FixProposal,
  autoApplySources: string[],
  autoApplyMaxLines: number,
): RiskLevel {
  if (classifyBySource(d, autoApplySources) !== 'low') return 'high';
  if (patchLineCount(fix) > autoApplyMaxLines) return 'high';
  return 'low';
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/risk.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/risk.ts test/risk.test.ts
git commit -m "feat(risk): source + patch size risk classification with TDD"
```

---

### Task 7: prompt.ts — LLM 提示組裝

`Files:`
- Create: `src/prompt.ts`
- Test: `test/prompt.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFixPrompt } from '../src/prompt';
import { RepresentativeDiagnostic, FixProposal } from '../src/types';

const rep: RepresentativeDiagnostic = {
  info: {
    uri: 'file:///proj/src/a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used.",
    severity: 'warning',
    range: { start: { line: 4, character: 0 }, end: { line: 4, character: 3 } },
  },
  groupSize: 1,
  groupUris: [],
};

const fileText = [
  'import x from "y";',                // line 0
  '',                                   // line 1
  'export function f() {',              // line 2
  '  const foo = 1;',                   // line 3
  '  return x;',                        // line 4
  '}',                                  // line 5
].join('\n');

describe('buildFixPrompt', () => {
  it('contains the file path, snippet around the diagnostic, and instructions', () => {
    const { system, user } = buildFixPrompt({
      diagnostic: rep,
      fileUri: 'file:///proj/src/a.ts',
      fileText,
    });
    expect(system).toMatch(/JSON/i);
    expect(system).toMatch(/oldText/);
    expect(user).toContain('file:///proj/src/a.ts');
    expect(user).toContain("Variable 'foo' is defined but never used");
    expect(user).toContain('const foo = 1;');
  });

  it('includes context lines around the diagnostic range', () => {
    const { user } = buildFixPrompt({
      diagnostic: rep,
      fileUri: 'file:///proj/src/a.ts',
      fileText,
      contextLines: 2,
    });
    // 應該至少包含前後 2 行
    expect(user).toContain('export function f() {');
    expect(user).toContain('return x;');
  });
});

// parseFixResponse 測試在 Step 4 補上,先只驗 buildFixPrompt。
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/prompt.test.ts`
Expected: 失敗,`Cannot find module '../src/prompt'`。

- [ ] `Step 3: 實作 prompt.ts

`src/prompt.ts`:

```ts
// src/prompt.ts — 純邏輯,組 LLM 提示。
import { DiagnosticInfo, FixProposal, RepresentativeDiagnostic } from './types';

export interface PromptInput {
  diagnostic: RepresentativeDiagnostic;
  fileUri: string;
  fileText: string;
  contextLines?: number;   // 預設 3
}

export interface BuiltPrompt {
  system: string;
  user: string;
}

const SYSTEM = `You are Log Doctor, a precise code-fixing assistant.
You will receive a single VSCode diagnostic and the file it points to.
Respond ONLY with a JSON object of the form:
{
  "fixes": [
    { "uri": "<exact file uri>", "oldText": "<verbatim substring of file>", "newText": "<replacement>", "rationale": "<one sentence>" }
  ]
}
Rules:
- oldText MUST appear verbatim in the file. Do not paraphrase.
- newText MUST be a drop-in replacement at the same location.
- If the fix is uncertain, return { "fixes": [] } and explain in rationale.
- Never touch lines outside the diagnostic range unless strictly required.
- No prose outside the JSON.`;

/** 依行號從全文抽出診斷周圍的 snippet。 */
function snippetAround(
  text: string,
  startLine: number,
  endLine: number,
  context: number,
): string {
  const lines = text.split('\n');
  const lo = Math.max(0, startLine - context);
  const hi = Math.min(lines.length - 1, endLine + context);
  return lines
    .slice(lo, hi + 1)
    .map((l, i) => `${lo + i + 1}: ${l}`)
    .join('\n');
}

export function buildFixPrompt(input: PromptInput): BuiltPrompt {
  const context = input.contextLines ?? 3;
  const d = input.diagnostic.info;
  const snippet = snippetAround(
    input.fileText,
    d.range.start.line,
    d.range.end.line,
    context,
  );
  const user = [
    `File: ${input.fileUri}`,
    `Source: ${d.source}${d.code !== undefined ? ` (${d.code})` : ''}`,
    `Severity: ${d.severity}`,
    `Range: line ${d.range.start.line + 1}, col ${d.range.start.character + 1}` +
      (d.range.start.line !== d.range.end.line
        ? ` to line ${d.range.end.line + 1}, col ${d.range.end.character + 1}`
        : ''),
    `Message: ${d.message}`,
    `Group: this diagnostic represents ${input.diagnostic.groupSize} occurrence(s) across: ${
      [input.fileUri, ...input.diagnostic.groupUris].join(', ')
    }`,
    ``,
    `Snippet:`,
    '```',
    snippet,
    '```',
    ``,
    `Return JSON only.`,
  ].join('\n');
  return { system: SYSTEM, user };
}

/** 從 LLM 回傳文字抽出 fixes 陣列;解析失敗時回傳空陣列並附上錯誤。 */
export function parseFixResponse(raw: string): { fixes: FixProposal[]; error?: string } {
  const trimmed = raw.trim();
  // 寬容解析:允許 ```json ... ``` 包裹
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = fenced ? fenced[1] : trimmed;
  try {
    const parsed = JSON.parse(body);
    if (!parsed || !Array.isArray(parsed.fixes)) {
      return { fixes: [], error: 'missing fixes[]' };
    }
    const fixes: FixProposal[] = parsed.fixes.map((f: any) => ({
      uri: String(f.uri ?? ''),
      oldText: String(f.oldText ?? ''),
      newText: String(f.newText ?? ''),
      rationale: f.rationale ? String(f.rationale) : undefined,
    }));
    return { fixes };
  } catch (e) {
    return { fixes: [], error: (e as Error).message };
  }
}
```

- [ ] `Step 4: 補一個 parser 測試

編輯 `test/prompt.test.ts`,把 skip 區塊替換成:

```ts
import { parseFixResponse } from '../src/prompt';

describe('parseFixResponse', () => {
  it('parses a plain JSON object', () => {
    const raw = JSON.stringify({
      fixes: [
        { uri: 'file:///a.ts', oldText: 'a', newText: 'b', rationale: 'fix' },
      ],
    });
    const { fixes, error } = parseFixResponse(raw);
    expect(error).toBeUndefined();
    expect(fixes).toEqual([
      { uri: 'file:///a.ts', oldText: 'a', newText: 'b', rationale: 'fix' },
    ]);
  });

  it('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n{"fixes":[]}\n```';
    const { fixes, error } = parseFixResponse(raw);
    expect(error).toBeUndefined();
    expect(fixes).toEqual([]);
  });

  it('returns error for non-JSON content', () => {
    const { fixes, error } = parseFixResponse('not json');
    expect(fixes).toEqual([]);
    expect(error).toBeTruthy();
  });

  it('returns error when fixes is missing', () => {
    const { fixes, error } = parseFixResponse(JSON.stringify({}));
    expect(fixes).toEqual([]);
    expect(error).toMatch(/fixes/);
  });
});
```

- [ ] `Step 5: 執行測試,確認全部通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/prompt.test.ts`
Expected: 全部通過。

- [ ] `Step 6: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/prompt.ts test/prompt.test.ts
git commit -m "feat(prompt): build LLM prompts and parse JSON fix responses"
```

---

## Phase 4: 設定與持久化 (Config & Persistence)

### Task 8: config.ts — 讀設定 + SecretStorage

`Files:`
- Create: `src/config.ts`
- Test: `test/config.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/config.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMock = vi.fn();
const storeMock = { get: getMock, store: vi.fn() };

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: unknown) => {
        const map: Record<string, unknown> = {
          'logDoctor.provider': 'claude',
          'logDoctor.model': 'claude-sonnet-4-6',
          'logDoctor.autoApplySources': ['eslint', 'prettier'],
          'logDoctor.autoApplyMaxLines': 5,
          'logDoctor.maxIssues': 20,
          'logDoctor.cooldownMinutes': 10,
        };
        return key in map ? map[key] : def;
      }),
    })),
    onDidChangeConfiguration: vi.fn(),
  },
  SecretStorage: class {},
  EventEmitter: class {
    fire = vi.fn();
    event = vi.fn();
    dispose = vi.fn();
  },
}));

// secrets 介面
const get2 = vi.fn();
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: unknown) => {
        const map: Record<string, unknown> = {
          'logDoctor.provider': 'claude',
          'logDoctor.model': 'claude-sonnet-4-6',
          'logDoctor.autoApplySources': ['eslint', 'prettier'],
          'logDoctor.autoApplyMaxLines': 5,
          'logDoctor.maxIssues': 20,
          'logDoctor.cooldownMinutes': 10,
        };
        return key in map ? map[key] : def;
      }),
    })),
  },
  SecretStorage: class {},
}));

import { loadConfig, getApiKey } from '../src/config';

describe('loadConfig', () => {
  it('returns a fully populated snapshot', async () => {
    const snap = loadConfig();
    expect(snap).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      autoApplySources: ['eslint', 'prettier'],
      autoApplyMaxLines: 5,
      maxIssues: 20,
      cooldownMinutes: 10,
    });
  });

  it('coerces unknown provider to claude', () => {
    // 由於測試固定 map,此案例可改為對 default 行為的檢查:用空白 mock 驗證預設值。
  });
});

describe('getApiKey', () => {
  it('returns key from SecretStorage for the active provider', async () => {
    get2.mockResolvedValueOnce('sk-test');
    const key = await getApiKey('claude', { get: get2, store: vi.fn() } as any);
    expect(key).toBe('sk-test');
  });

  it('returns undefined when key missing', async () => {
    get2.mockResolvedValueOnce(undefined);
    const key = await getApiKey('claude', { get: get2, store: vi.fn() } as any);
    expect(key).toBeUndefined();
  });
});
```

> 注意:上面 mock 區段重複了,實作時只留一份。為簡化,可在 `beforeEach` 重設 `vi.clearAllMocks()`。

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/config.test.ts`
Expected: 失敗,`Cannot find module '../src/config'`。

- [ ] `Step 3: 實作 config.ts

`src/config.ts`:

```ts
// src/config.ts — 讀設定 + 從 SecretStorage 取 API key。
import * as vscode from 'vscode';
import { ConfigSnapshot, ProviderName } from './types';

const KEY_BY_PROVIDER: Record<ProviderName, string> = {
  claude: 'logDoctor.apiKey.claude',
  openai: 'logDoctor.apiKey.openai',
};

export function loadConfig(): ConfigSnapshot {
  const cfg = vscode.workspace.getConfiguration('logDoctor');
  const providerRaw = cfg.get<string>('provider', 'claude');
  const provider: ProviderName = providerRaw === 'openai' ? 'openai' : 'claude';
  return {
    provider,
    model: cfg.get<string>('model', provider === 'claude' ? 'claude-sonnet-4-6' : 'gpt-4o'),
    autoApplySources: cfg.get<string[]>('autoApplySources', [
      'eslint',
      'prettier',
      'ruff',
      'gofmt',
      'stylelint',
    ]),
    autoApplyMaxLines: cfg.get<number>('autoApplyMaxLines', 3),
    maxIssues: cfg.get<number>('maxIssues', 50),
    cooldownMinutes: cfg.get<number>('cooldownMinutes', 30),
  };
}

export async function getApiKey(
  provider: ProviderName,
  secrets: vscode.SecretStorage,
): Promise<string | undefined> {
  return secrets.get(KEY_BY_PROVIDER[provider]);
}

export async function setApiKey(
  provider: ProviderName,
  key: string,
  secrets: vscode.SecretStorage,
): Promise<void> {
  await secrets.store(KEY_BY_PROVIDER[provider], key);
}
```

清理 `test/config.test.ts` 的 mock,改成:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: unknown) => {
        const map: Record<string, unknown> = {
          'logDoctor.provider': 'claude',
          'logDoctor.model': 'claude-sonnet-4-6',
          'logDoctor.autoApplySources': ['eslint', 'prettier'],
          'logDoctor.autoApplyMaxLines': 5,
          'logDoctor.maxIssues': 20,
          'logDoctor.cooldownMinutes': 10,
        };
        return key in map ? map[key] : def;
      }),
    })),
  },
  SecretStorage: class {},
}));

import { loadConfig, getApiKey } from '../src/config';

describe('loadConfig', () => {
  it('returns a fully populated snapshot', () => {
    const snap = loadConfig();
    expect(snap).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      autoApplySources: ['eslint', 'prettier'],
      autoApplyMaxLines: 5,
      maxIssues: 20,
      cooldownMinutes: 10,
    });
  });
});

describe('getApiKey', () => {
  it('returns key from SecretStorage for the active provider', async () => {
    const get = vi.fn().mockResolvedValue('sk-test');
    const key = await getApiKey('claude', { get, store: vi.fn() } as any);
    expect(key).toBe('sk-test');
    expect(get).toHaveBeenCalledWith('logDoctor.apiKey.claude');
  });

  it('returns undefined when key missing', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const key = await getApiKey('claude', { get, store: vi.fn() } as any);
    expect(key).toBeUndefined();
  });
});
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/config.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/config.ts test/config.test.ts
git commit -m "feat(config): load config snapshot and read API key from SecretStorage"
```

---

### Task 9: queue.ts — workspaceState 持久化佇列

`Files:`
- Create: `src/queue.ts`
- Test: `test/queue.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/queue.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { PersistentQueue } from '../src/queue';
import { QueueItem, RepresentativeDiagnostic } from '../src/types';

function memento(): { get: any; update: any; keys: any } {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn((k: string) => data.get(k)),
    update: vi.fn((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    keys: () => Array.from(data.keys()),
  };
}

function item(id: string, priority: number, uri: string): QueueItem {
  const rep: RepresentativeDiagnostic = {
    info: {
      uri,
      source: 'eslint',
      message: id,
      severity: 'warning',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    },
    groupSize: 1,
    groupUris: [],
  };
  return {
    id,
    diagnostic: rep,
    priority,
    attempts: 0,
    status: 'pending',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('PersistentQueue', () => {
  it('adds and lists items sorted by priority', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 2, 'file:///a'));
    await q.add(item('b', 0, 'file:///b'));
    await q.add(item('c', 1, 'file:///c'));
    const list = q.list();
    expect(list.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('removes an item by id', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.add(item('b', 1, 'file:///b'));
    await q.remove('a');
    expect(q.list().map((i) => i.id)).toEqual(['b']);
  });

  it('updates item fields by id', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.update('a', { status: 'in_flight', attempts: 1 });
    const got = q.list()[0];
    expect(got.status).toBe('in_flight');
    expect(got.attempts).toBe(1);
  });

  it('picks the next pending item with lowest priority number', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 5, 'file:///a'));
    await q.add(item('b', 0, 'file:///b'));
    await q.add(item('c', 3, 'file:///c'));
    expect(q.peek()?.id).toBe('b');
  });

  it('persists across instances via the same memento', async () => {
    const m = memento();
    const q1 = new PersistentQueue(m as any);
    await q1.add(item('a', 0, 'file:///a'));
    const q2 = new PersistentQueue(m as any);
    expect(q2.list()).toHaveLength(1);
  });

  it('ignores duplicates when adding the same id twice', async () => {
    const m = memento();
    const q = new PersistentQueue(m as any);
    await q.add(item('a', 0, 'file:///a'));
    await q.add(item('a', 0, 'file:///a'));
    expect(q.list()).toHaveLength(1);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/queue.test.ts`
Expected: 失敗,`Cannot find module '../src/queue'`。

- [ ] `Step 3: 實作 queue.ts

`src/queue.ts`:

```ts
// src/queue.ts — 持久化佇列,以 workspaceState 為儲存後端。
import type { Memento } from 'vscode';
import { QueueItem } from './types';

const STORAGE_KEY = 'logDoctor.queue.v1';

export class PersistentQueue {
  private items: QueueItem[] = [];
  private loaded = false;

  constructor(private readonly memento: Memento) {}

  /** 從 memento 載入;若已載入則快取。 */
  load(): void {
    if (this.loaded) return;
    const raw = this.memento.get<QueueItem[]>(STORAGE_KEY, []);
    this.items = Array.isArray(raw) ? raw : [];
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.memento.update(STORAGE_KEY, this.items);
  }

  /** 加入佇列。同 id 視為已存在,不重複加入。 */
  async add(item: QueueItem): Promise<void> {
    this.load();
    if (this.items.some((i) => i.id === item.id)) return;
    this.items.push({ ...item, updatedAt: Date.now() });
    await this.save();
  }

  /** 依 id 移除。 */
  async remove(id: string): Promise<void> {
    this.load();
    this.items = this.items.filter((i) => i.id !== id);
    await this.save();
  }

  /** 局部更新;傳入 partial 合併進既有項目。 */
  async update(id: string, patch: Partial<QueueItem>): Promise<void> {
    this.load();
    this.items = this.items.map((i) =>
      i.id === id ? { ...i, ...patch, id: i.id, updatedAt: Date.now() } : i,
    );
    await this.save();
  }

  /** 全部項目 (依 priority 排序)。 */
  list(): QueueItem[] {
    this.load();
    return [...this.items].sort((a, b) => a.priority - b.priority);
  }

  /** 取得優先最高的 pending 項,不移除。 */
  peek(): QueueItem | undefined {
    this.load();
    return this.items
      .filter((i) => i.status === 'pending')
      .sort((a, b) => a.priority - b.priority)[0];
  }

  /** 全部清空(主要給測試 / 重置流程用)。 */
  async clear(): Promise<void> {
    this.load();
    this.items = [];
    await this.save();
  }
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/queue.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/queue.ts test/queue.test.ts
git commit -m "feat(queue): persistent queue backed by workspaceState"
```

---

### Task 10: scheduler.ts — 冷卻計算 + 序列化

`Files:`
- Create: `src/scheduler.ts`
- Test: `test/scheduler.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/scheduler.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/scheduler';
import type { Memento } from 'vscode';

function memento(): Memento {
  const data = new Map<string, unknown>();
  return {
    get: vi.fn((k: string) => data.get(k)),
    update: vi.fn((k: string, v: unknown) => {
      data.set(k, v);
      return Promise.resolve();
    }),
    keys: () => Array.from(data.keys()),
  } as any;
}

describe('Scheduler.canRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-16T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when never applied', () => {
    const s = new Scheduler(memento(), 30);
    expect(s.canRun()).toBe(true);
  });

  it('returns false within cooldown window', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(10 * 60 * 1000); // 10 min later
    expect(s.canRun()).toBe(false);
  });

  it('returns true after cooldown window', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(31 * 60 * 1000); // 31 min later
    expect(s.canRun()).toBe(true);
  });

  it('persists timestamp across instances', () => {
    const m = memento();
    const s1 = new Scheduler(m, 30);
    s1.markApplied();
    const s2 = new Scheduler(m, 30);
    expect(s2.canRun()).toBe(false);
  });

  it('treats cooldownMinutes = 0 as always runnable', () => {
    const m = memento();
    const s = new Scheduler(m, 0);
    s.markApplied();
    expect(s.canRun()).toBe(true);
  });

  it('msUntilNextRun returns the remaining wait time', () => {
    const m = memento();
    const s = new Scheduler(m, 30);
    s.markApplied();
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(s.msUntilNextRun()).toBe(25 * 60 * 1000);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/scheduler.test.ts`
Expected: 失敗,`Cannot find module '../src/scheduler'`。

- [ ] `Step 3: 實作 scheduler.ts

`src/scheduler.ts`:

```ts
// src/scheduler.ts — 全域冷卻 (上次套用後 N 分鐘內不允許再套用)。
import type { Memento } from 'vscode';

const KEY = 'logDoctor.lastAppliedAt.v1';

export class Scheduler {
  private lastAppliedAt: number | null = null;

  constructor(
    private readonly memento: Memento,
    private readonly cooldownMinutes: number,
  ) {
    const stored = this.memento.get<number | null>(KEY, null);
    this.lastAppliedAt = typeof stored === 'number' ? stored : null;
  }

  /** 是否可立即執行一次套用。 */
  canRun(now: number = Date.now()): boolean {
    if (this.cooldownMinutes <= 0) return true;
    if (this.lastAppliedAt === null) return true;
    const elapsed = now - this.lastAppliedAt;
    return elapsed >= this.cooldownMinutes * 60 * 1000;
  }

  /** 距離下次可執行的毫秒數;若已可執行回傳 0。 */
  msUntilNextRun(now: number = Date.now()): number {
    if (this.canRun(now)) return 0;
    const elapsed = now - (this.lastAppliedAt ?? now);
    return this.cooldownMinutes * 60 * 1000 - elapsed;
  }

  /** 標記現在套用一次 (寫入 memento + 同步記憶體)。 */
  async markApplied(now: number = Date.now()): Promise<void> {
    this.lastAppliedAt = now;
    await this.memento.update(KEY, now);
  }
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/scheduler.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/scheduler.ts test/scheduler.test.ts
git commit -m "feat(scheduler): global cooldown with workspaceState persistence"
```

---

## Phase 5: LLM Provider 層

### Task 11: providers/provider.ts — 共用介面

`Files:`
- Create: `src/providers/provider.ts`

- [ ] `Step 1: 建立 provider.ts

```ts
// src/providers/provider.ts — LLM provider 抽象。
import { FixProposal, ProviderName } from '../types';

export interface Provider {
  readonly name: ProviderName;
  send(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

/** 從 provider 文字回傳解析出 fix proposals;薄封裝避免每處重複 try/catch。 */
import { parseFixResponse } from '../prompt';

export async function sendForFixes(
  provider: Provider,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ fixes: FixProposal[]; error?: string }> {
  const raw = await provider.send(system, user, signal);
  return parseFixResponse(raw);
}
```

- [ ] `Step 2: 確認 tsc 編譯

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤。

- [ ] `Step 3: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/providers/provider.ts
git commit -m "feat(provider): define Provider interface and sendForFixes helper"
```

---

### Task 12: providers/claude.ts — Anthropic SDK

`Files:`
- Create: `src/providers/claude.ts`
- Test: `test/providers/claude.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/providers/claude.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

import { ClaudeProvider } from '../../src/providers/claude';

describe('ClaudeProvider', () => {
  it('calls messages.create with system and user messages', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"fixes":[]}' }],
    });
    const p = new ClaudeProvider({ apiKey: 'sk-test', model: 'claude-sonnet-4-6' });
    const out = await p.send('SYS', 'USR');
    expect(out).toBe('{"fixes":[]}');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: 'SYS',
        messages: [{ role: 'user', content: 'USR' }],
      }),
    );
  });

  it('propagates errors from the SDK', async () => {
    createMock.mockRejectedValueOnce(new Error('boom'));
    const p = new ClaudeProvider({ apiKey: 'sk', model: 'm' });
    await expect(p.send('S', 'U')).rejects.toThrow('boom');
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/claude.test.ts`
Expected: 失敗,`Cannot find module '../../src/providers/claude'`。

- [ ] `Step 3: 實作 claude.ts

`src/providers/claude.ts`:

```ts
// src/providers/claude.ts — Anthropic Claude provider。
import Anthropic from '@anthropic-ai/sdk';
import { Provider } from './provider';
import { ProviderName } from '../types';

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export class ClaudeProvider implements Provider {
  readonly name: ProviderName = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 2048;
  }

  async send(system: string, user: string, signal?: AbortSignal): Promise<string> {
    const res = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
      signal ? { signal } : undefined,
    );
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('Claude returned no text block');
    }
    return block.text;
  }
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/claude.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/providers/claude.ts test/providers/claude.test.ts
git commit -m "feat(provider-claude): Anthropic SDK implementation with mockable test"
```

---

### Task 13: providers/openai.ts — OpenAI SDK

`Files:`
- Create: `src/providers/openai.ts`
- Test: `test/providers/openai.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/providers/openai.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: createMock } },
    })),
  };
});

import { OpenAIProvider } from '../../src/providers/openai';

describe('OpenAIProvider', () => {
  it('calls chat.completions.create with system + user messages', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"fixes":[]}' } }],
    });
    const p = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o' });
    const out = await p.send('SYS', 'USR');
    expect(out).toBe('{"fixes":[]}');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'USR' },
        ],
      }),
    );
  });

  it('throws when no choice returned', async () => {
    createMock.mockResolvedValueOnce({ choices: [] });
    const p = new OpenAIProvider({ apiKey: 'sk', model: 'm' });
    await expect(p.send('S', 'U')).rejects.toThrow(/no choice/i);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/openai.test.ts`
Expected: 失敗,`Cannot find module '../../src/providers/openai'`。

- [ ] `Step 3: 實作 openai.ts

`src/providers/openai.ts`:

```ts
// src/providers/openai.ts — OpenAI provider。
import OpenAI from 'openai';
import { Provider } from './provider';
import { ProviderName } from '../types';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export class OpenAIProvider implements Provider {
  readonly name: ProviderName = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 2048;
  }

  async send(system: string, user: string, signal?: AbortSignal): Promise<string> {
    const res = await this.client.chat.completions.create(
      {
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      signal ? { signal } : undefined,
    );
    const choice = res.choices[0];
    if (!choice?.message?.content) {
      throw new Error('OpenAI returned no choice content');
    }
    return choice.message.content;
  }
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/openai.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/providers/openai.ts test/providers/openai.test.ts
git commit -m "feat(provider-openai): OpenAI SDK implementation with mockable test"
```

---

### Task 14: providers/factory.ts — provider 挑選

`Files:`
- Create: `src/providers/factory.ts`
- Test: `test/providers/factory.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/providers/factory.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

const claudeCtor = vi.fn();
const openaiCtor = vi.fn();

vi.mock('../../src/providers/claude', () => ({
  ClaudeProvider: claudeCtor,
}));
vi.mock('../../src/providers/openai', () => ({
  OpenAIProvider: openaiCtor,
}));

import { createProvider } from '../../src/providers/factory';
import { ConfigSnapshot } from '../../src/types';

const base: ConfigSnapshot = {
  provider: 'claude',
  model: 'm',
  autoApplySources: [],
  autoApplyMaxLines: 3,
  maxIssues: 50,
  cooldownMinutes: 30,
};

describe('createProvider', () => {
  it('returns ClaudeProvider when provider=claude', () => {
    createProvider({ ...base, provider: 'claude' }, 'sk-x');
    expect(claudeCtor).toHaveBeenCalledWith({ apiKey: 'sk-x', model: 'm' });
    expect(openaiCtor).not.toHaveBeenCalled();
  });

  it('returns OpenAIProvider when provider=openai', () => {
    createProvider({ ...base, provider: 'openai' }, 'sk-y');
    expect(openaiCtor).toHaveBeenCalledWith({ apiKey: 'sk-y', model: 'm' });
    expect(claudeCtor).not.toHaveBeenCalled();
  });

  it('throws when apiKey is empty', () => {
    expect(() => createProvider(base, '')).toThrow(/api key/i);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/factory.test.ts`
Expected: 失敗,`Cannot find module '../../src/providers/factory'`。

- [ ] `Step 3: 實作 factory.ts

`src/providers/factory.ts`:

```ts
// src/providers/factory.ts — 依 ConfigSnapshot 與 API key 挑 provider。
import { ConfigSnapshot } from '../types';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { Provider } from './provider';

export function createProvider(cfg: ConfigSnapshot, apiKey: string): Provider {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Log Doctor: API key is empty. Set it via SecretStorage.');
  }
  switch (cfg.provider) {
    case 'claude':
      return new ClaudeProvider({ apiKey, model: cfg.model });
    case 'openai':
      return new OpenAIProvider({ apiKey, model: cfg.model });
  }
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/providers/factory.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/providers/factory.ts test/providers/factory.test.ts
git commit -m "feat(provider-factory): pick provider by config and validate api key"
```

---

## Phase 6: 工作流模組 (Workflow)

### Task 15: collector.ts — 抓 diagnostics

`Files:`
- Create: `src/collector.ts`
- Test: `test/collector.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/collector.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { collectDiagnostics } from '../src/collector';

function makeDiag(over: any = {}): any {
  return {
    source: 'eslint',
    code: { value: 'no-unused-vars' },
    message: 'x is defined but never used',
    severity: 1, // Warning
    range: {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    },
    ...over,
  };
}

describe('collectDiagnostics', () => {
  it('maps vscode diagnostics to DiagnosticInfo', () => {
    const uri = { fsPath: '/proj/a.ts', toString: () => 'file:///proj/a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag()]]]));
    const info = collectDiagnostics(getDiagnostics as any);
    expect(info).toHaveLength(1);
    expect(info[0]).toMatchObject({
      uri: 'file:///proj/a.ts',
      source: 'eslint',
      code: 'no-unused-vars',
      message: 'x is defined but never used',
      severity: 'warning',
    });
  });

  it('skips diagnostics with no source', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ source: undefined })]]]));
    expect(collectDiagnostics(getDiagnostics as any)).toEqual([]);
  });

  it('skips hint-severity diagnostics', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    // Hint = 4
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ severity: 4 })]]]));
    expect(collectDiagnostics(getDiagnostics as any)).toEqual([]);
  });

  it('handles numeric code values', () => {
    const uri = { fsPath: '/a.ts', toString: () => 'file:///a.ts' } as any;
    const getDiagnostics = vi.fn(() => new Map([[uri, [makeDiag({ code: 2304 })]]]));
    const info = collectDiagnostics(getDiagnostics as any);
    expect(info[0].code).toBe(2304);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/collector.test.ts`
Expected: 失敗,`Cannot find module '../src/collector'`。

- [ ] `Step 3: 實作 collector.ts

`src/collector.ts`:

```ts
// src/collector.ts — 從 vscode 抓 diagnostics 並轉成內部型別。
import type { Diagnostic, Uri, DiagnosticSeverity } from 'vscode';
import { DiagnosticInfo, Severity } from './types';

export type GetDiagnosticsFn = () => Map<Uri, Diagnostic[]>;

const SEVERITY_MAP: Record<DiagnosticSeverity, Severity | null> = {
  0: 'error',      // Error
  1: 'warning',    // Warning
  2: 'info',       // Information
  3: 'hint',       // Hint
  // 防呆:對未來新增值不假設,直接視為 info
};

function codeToString(code: Diagnostic['code']): string | number | undefined {
  if (code === undefined || code === null) return undefined;
  if (typeof code === 'string' || typeof code === 'number') return code;
  // vscode.DiagnosticCode = string | number | { value, target }
  return (code as { value: string | number }).value;
}

export function collectDiagnostics(
  getDiagnostics: GetDiagnosticsFn,
): DiagnosticInfo[] {
  const all = getDiagnostics();
  const out: DiagnosticInfo[] = [];
  for (const [uri, diags] of all) {
    for (const d of diags) {
      if (!d.source) continue; // 沒 source 代表不是 linter,跳過
      const sevNum = typeof d.severity === 'number' ? d.severity : 1;
      const sev = SEVERITY_MAP[sevNum as DiagnosticSeverity] ?? 'info';
      if (sev === 'hint') continue;
      out.push({
        uri: uri.toString(),
        source: d.source,
        code: codeToString(d.code),
        message: d.message,
        severity: sev,
        range: {
          start: { line: d.range.start.line, character: d.range.start.character },
          end: { line: d.range.end.line, character: d.range.end.character },
        },
        raw: d,
      });
    }
  }
  return out;
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/collector.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/collector.ts test/collector.test.ts
git commit -m "feat(collector): map vscode diagnostics to internal DiagnosticInfo"
```

---

### Task 16: report.ts — Output channel 摘要

`Files:`
- Create: `src/report.ts`

- [ ] `Step 1: 建立 report.ts

```ts
// src/report.ts — 共用 Output channel,集中顯示進度與結果。
import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function getReportChannel(): vscode.OutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('Log Doctor');
  }
  return channel;
}

export function log(message: string): void {
  getReportChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
}

export function show(): void {
  getReportChannel().show(true);
}
```

- [ ] `Step 2: 確認 tsc 編譯

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤。

- [ ] `Step 3: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/report.ts
git commit -m "feat(report): shared Output channel for progress and results"
```

---

### Task 17: fixer.ts — 編排 (代表項 → 提示 → provider → 修補)

`Files:`
- Create: `src/fixer.ts`
- Test: `test/fixer.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/fixer.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { fixOne } from '../src/fixer';
import { RepresentativeDiagnostic } from '../src/types';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

const rep: RepresentativeDiagnostic = {
  info: {
    uri: 'file:///proj/a.ts',
    source: 'eslint',
    code: 'no-unused-vars',
    message: "Variable 'foo' is defined but never used.",
    severity: 'warning',
    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 9 } },
  },
  groupSize: 1,
  groupUris: [],
};

describe('fixOne', () => {
  it('returns proposals from provider and resolves uri to fsPath', async () => {
    (fs.readFile as any).mockResolvedValue('const foo = 1;\n');
    const provider = {
      name: 'claude' as const,
      send: vi.fn().mockResolvedValue(
        JSON.stringify({
          fixes: [
            {
              uri: 'file:///proj/a.ts',
              oldText: 'const foo = 1;',
              newText: '',
              rationale: 'unused',
            },
          ],
        }),
      ),
    };
    const proposals = await fixOne({ diagnostic: rep, provider });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].uri).toBe('file:///proj/a.ts');
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it('returns empty array and error when response is not parseable', async () => {
    (fs.readFile as any).mockResolvedValue('const foo = 1;\n');
    const provider = { name: 'claude' as const, send: vi.fn().mockResolvedValue('not json') };
    const result = await fixOne({ diagnostic: rep, provider });
    expect(result.fixes).toEqual([]);
    expect(result.error).toBeTruthy();
  });

  it('skips proposals whose uri does not match the diagnostic', async () => {
    (fs.readFile as any).mockResolvedValue('x');
    const provider = {
      name: 'claude' as const,
      send: vi.fn().mockResolvedValue(
        JSON.stringify({ fixes: [{ uri: 'file:///other.ts', oldText: 'a', newText: 'b' }] }),
      ),
    };
    const result = await fixOne({ diagnostic: rep, provider });
    expect(result.fixes).toEqual([]);
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/fixer.test.ts`
Expected: 失敗,`Cannot find module '../src/fixer'`。

- [ ] `Step 3: 實作 fixer.ts

`src/fixer.ts`:

```ts
// src/fixer.ts — 取代表項、讀檔、組提示、打 provider、解析修補。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildFixPrompt } from './prompt';
import { sendForFixes } from './providers/provider';
import { FixProposal, RepresentativeDiagnostic } from './types';
import type { Provider } from './providers/provider';

export interface FixOneInput {
  diagnostic: RepresentativeDiagnostic;
  provider: Provider;
  contextLines?: number;
}

export interface FixOneResult {
  fixes: FixProposal[];
  error?: string;
}

function uriToFsPath(uri: string): string {
  if (uri.startsWith('file://')) return fileURLToPath(uri);
  return uri;
}

export async function fixOne(input: FixOneInput): Promise<FixOneResult> {
  const uri = input.diagnostic.info.uri;
  const fsPath = uriToFsPath(uri);
  let fileText: string;
  try {
    fileText = await readFile(fsPath, 'utf8');
  } catch (e) {
    return { fixes: [], error: `cannot read ${fsPath}: ${(e as Error).message}` };
  }

  const { system, user } = buildFixPrompt({
    diagnostic: input.diagnostic,
    fileUri: uri,
    fileText,
    contextLines: input.contextLines,
  });

  const { fixes, error } = await sendForFixes(input.provider, system, user);
  // 過濾:只保留對應這個診斷 uri 的修補,其他視為雜訊丟棄
  const matched = fixes.filter((f) => f.uri === uri);
  return { fixes: matched, error: matched.length === 0 ? error : undefined };
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/fixer.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/fixer.ts test/fixer.test.ts
git commit -m "feat(fixer): orchestrate prompt + provider call + fix proposal parsing"
```

---

### Task 18: applier.ts — WorkspaceEdit 套用 / 顯示 diff

`Files:`
- Create: `src/applier.ts`
- Test: `test/applier.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/applier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildWorkspaceEdit, needsConfirmation, applyOrConfirm } from '../src/applier';
import { FixProposal, DiagnosticInfo } from '../src/types';

const d: DiagnosticInfo = {
  uri: 'file:///proj/a.ts',
  source: 'eslint',
  message: 'x',
  severity: 'warning',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
};

const fix: FixProposal = {
  uri: 'file:///proj/a.ts',
  oldText: 'const foo = 1;',
  newText: '',
  rationale: 'unused',
};

describe('buildWorkspaceEdit', () => {
  it('creates a single TextEdit replacing oldText with newText', () => {
    const edit = buildWorkspaceEdit(fix, 'const foo = 1;\nconst bar = 2;');
    expect(edit.size).toBe(1);
    const fileEdit = edit.get(vscodeUri('file:///proj/a.ts'));
    expect(fileEdit).toBeDefined();
    const first = fileEdit![0];
    expect(first.range.start.line).toBe(0);
    expect(first.range.start.character).toBe(0);
    expect(first.newText).toBe('');
  });

  it('throws when oldText not found in file', () => {
    expect(() => buildWorkspaceEdit(fix, 'totally different content')).toThrow(/oldText/);
  });
});

describe('needsConfirmation', () => {
  it('returns true for high-risk source', () => {
    expect(needsConfirmation(d, fix, ['eslint'], 3)).toBe(true);
  });

  it('returns false for low-risk small patch', () => {
    expect(needsConfirmation({ ...d, source: 'eslint' }, fix, ['eslint'], 3)).toBe(false);
  });
});

describe('applyOrConfirm', () => {
  it('applies directly when low risk', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('apply');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix: { ...fix, newText: '' },
      diagnostic: { ...d, source: 'eslint' },
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(result.applied).toBe(true);
    expect(apply).toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it('shows diff and asks when high risk', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('apply');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix,
      diagnostic: d,
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(show).toHaveBeenCalled();
    expect(result.applied).toBe(true);
  });

  it('does not apply when user declines', async () => {
    const apply = vi.fn().mockResolvedValue(true);
    const show = vi.fn().mockResolvedValue('reject');
    const result = await applyOrConfirm({
      fileText: 'const foo = 1;\n',
      fix,
      diagnostic: d,
      autoApplySources: ['eslint'],
      autoApplyMaxLines: 3,
      applyEdit: apply,
      showDiffAndAsk: show,
    });
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

function vscodeUri(s: string): any {
  return { fsPath: s.replace('file://', ''), toString: () => s, scheme: 'file' };
}
```

> 注意:這測試需要 `vscode` 的 `Uri` 在 `buildWorkspaceEdit` 內部使用;實作時請用 `vscode.Uri.parse` 或 `vscode.workspace.fs` 等,並在測試裡以 `vi.mock('vscode', ...)` 注入 `Uri.parse`。

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/applier.test.ts`
Expected: 失敗,`Cannot find module '../src/applier'`。

- [ ] `Step 3: 實作 applier.ts

`src/applier.ts`:

```ts
// src/applier.ts — 把 FixProposal 套成 WorkspaceEdit;低風險直接套、高風險顯示 diff。
import * as vscode from 'vscode';
import { decideRisk } from './risk';
import { DiagnosticInfo, FixProposal, RiskLevel } from './types';

export interface ApplyOrConfirmInput {
  fileText: string;
  fix: FixProposal;
  diagnostic: DiagnosticInfo;
  autoApplySources: string[];
  autoApplyMaxLines: number;
  applyEdit: (edit: vscode.WorkspaceEdit) => Promise<boolean>;
  showDiffAndAsk: (oldText: string, newText: string, uri: string) => Promise<'apply' | 'reject'>;
}

export interface ApplyOrConfirmResult {
  applied: boolean;
  risk: RiskLevel;
  reason?: string;
}

/** 從檔案內容找出 oldText 位置,回傳 (line, character)。 */
function locate(oldText: string, fileText: string): { line: number; character: number } {
  const idx = fileText.indexOf(oldText);
  if (idx === -1) {
    throw new Error(`oldText not found in file (length=${fileText.length}, needle=${oldText.length})`);
  }
  const before = fileText.slice(0, idx);
  const line = before.split('\n').length - 1;
  const lastNl = before.lastIndexOf('\n');
  const character = lastNl === -1 ? idx : idx - lastNl - 1;
  return { line, character };
}

/** 為一個修補建立 WorkspaceEdit (僅用記憶體物件,還沒套到工作區)。 */
export function buildWorkspaceEdit(
  fix: FixProposal,
  fileText: string,
): vscode.WorkspaceEdit {
  const { line, character } = locate(fix.oldText, fileText);
  const endIdx = fileText.indexOf(fix.oldText) + fix.oldText.length;
  const endLine = fileText.slice(0, endIdx).split('\n').length - 1;
  const lastNl = fileText.slice(0, endIdx).lastIndexOf('\n');
  const endChar = lastNl === -1 ? endIdx : endIdx - lastNl - 1;

  const edit = new vscode.WorkspaceEdit();
  const uri = vscode.Uri.parse(fix.uri);
  edit.replace(
    uri,
    new vscode.Range(
      new vscode.Position(line, character),
      new vscode.Position(endLine, endChar),
    ),
    fix.newText,
  );
  return edit;
}

/** 是否需要人工確認 (風險分流)。 */
export function needsConfirmation(
  d: DiagnosticInfo,
  fix: FixProposal,
  autoApplySources: string[],
  autoApplyMaxLines: number,
): boolean {
  return decideRisk(d, fix, autoApplySources, autoApplyMaxLines) === 'high';
}

/** 主流程:低風險直接套;高風險先請使用者看 diff。 */
export async function applyOrConfirm(input: ApplyOrConfirmInput): Promise<ApplyOrConfirmResult> {
  const risk = decideRisk(
    input.diagnostic,
    input.fix,
    input.autoApplySources,
    input.autoApplyMaxLines,
  );
  if (risk === 'high') {
    const answer = await input.showDiffAndAsk(input.fix.oldText, input.fix.newText, input.fix.uri);
    if (answer !== 'apply') {
      return { applied: false, risk, reason: 'user rejected' };
    }
  }
  const edit = buildWorkspaceEdit(input.fix, input.fileText);
  const ok = await input.applyEdit(edit);
  return { applied: ok, risk, reason: ok ? undefined : 'applyEdit returned false' };
}
```

- [ ] `Step 4: 修測試以 mock vscode

編輯 `test/applier.test.ts` 頂部加入 mock:

```ts
vi.mock('vscode', () => ({
  Uri: { parse: (s: string) => ({ fsPath: s.replace('file://', ''), toString: () => s, scheme: 'file' }) },
  Range: class {
    constructor(public start: any, public end: any) {}
  },
  Position: class {
    constructor(public line: number, public character: number) {}
  },
  WorkspaceEdit: class {
    private map = new Map<string, any[]>();
    replace(uri: any, _range: any, newText: string) {
      const arr = this.map.get(uri.toString()) ?? [];
      arr.push({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText });
      this.map.set(uri.toString(), arr);
    }
    get(uri: any) { return this.map.get(uri.toString()); }
    get size() { return this.map.size; }
  },
}));
```

`vscodeUri` 測試 helper 與 mock 同形 (都回傳 `{ fsPath, toString, scheme }`),可保留作為測試內部使用。

- [ ] `Step 5: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/applier.test.ts`
Expected: 全部通過。

- [ ] `Step 6: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/applier.ts test/applier.test.ts
git commit -m "feat(applier): WorkspaceEdit builder with mixed auto/confirm strategy"
```

---

### Task 19: verifier.ts — 重新收集 diagnostics,回歸還原

`Files:`
- Create: `src/verifier.ts`
- Test: `test/verifier.test.ts`

- [ ] `Step 1: 寫失敗的測試

`test/verifier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { verifyFix } from '../src/verifier';
import { DiagnosticInfo } from '../src/types';

function makeDiag(over: Partial<DiagnosticInfo> = {}): DiagnosticInfo {
  return {
    uri: 'file:///a.ts',
    source: 'eslint',
    message: 'unused',
    severity: 'warning',
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    ...over,
  };
}

describe('verifyFix', () => {
  it('resolves when the representative diagnostic disappears and no new errors appear', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after: DiagnosticInfo[] = [];
    const result = await verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    expect(result.outcome).toBe('resolved');
  });

  it('detects regression when a new error appears in same file', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after = [
      makeDiag({ uri: 'file:///a.ts', message: 'old' }),
      makeDiag({ uri: 'file:///a.ts', message: 'new error', severity: 'error' }),
    ];
    const result = await verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    expect(result.outcome).toBe('regressed');
    expect(result.regressionCount).toBe(1);
  });

  it('marks unresolved when representative still present but no regression', async () => {
    const before = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const after = [makeDiag({ uri: 'file:///a.ts', message: 'old' })];
    const result = await verifyFix({
      representative: { info: before[0], groupSize: 1, groupUris: [] },
      before,
      fetchAfter: async () => after,
    });
    expect(result.outcome).toBe('unresolved');
  });
});
```

- [ ] `Step 2: 執行測試,確認失敗

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/verifier.test.ts`
Expected: 失敗,`Cannot find module '../src/verifier'`。

- [ ] `Step 3: 實作 verifier.ts

`src/verifier.ts`:

```ts
// src/verifier.ts — 套用後重收 diagnostics,判定 resolved / unresolved / regressed。
import { DiagnosticInfo, RepresentativeDiagnostic } from './types';

export interface VerifyInput {
  representative: RepresentativeDiagnostic;
  before: DiagnosticInfo[];        // 套用前該檔 (或同組) 的所有 diagnostics
  fetchAfter: () => Promise<DiagnosticInfo[]>;  // 等 LSP 重檢後再呼叫
  debounceMs?: number;             // 預設 750
}

export type VerifyOutcome = 'resolved' | 'unresolved' | 'regressed';

export interface VerifyResult {
  outcome: VerifyOutcome;
  regressionCount?: number;
}

function sameSignature(a: DiagnosticInfo, b: DiagnosticInfo): boolean {
  return (
    a.uri === b.uri &&
    a.source === b.source &&
    a.code === b.code &&
    a.message === b.message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function verifyFix(input: VerifyInput): Promise<VerifyResult> {
  const debounce = input.debounceMs ?? 750;
  await sleep(debounce);
  const after = await input.fetchAfter();

  const rep = input.representative.info;
  const stillThere = after.some((d) => sameSignature(d, rep));

  // 計算同檔新出現的 error 級數
  const newErrorsInSameFile = after.filter(
    (d) => d.uri === rep.uri && d.severity === 'error' && !input.before.some((b) => sameSignature(b, d)),
  );

  if (newErrorsInSameFile.length > 0) {
    return { outcome: 'regressed', regressionCount: newErrorsInSameFile.length };
  }
  if (stillThere) {
    return { outcome: 'unresolved' };
  }
  return { outcome: 'resolved' };
}
```

- [ ] `Step 4: 執行測試,確認通過

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run test/verifier.test.ts`
Expected: 全部通過。

- [ ] `Step 5: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/verifier.ts test/verifier.test.ts
git commit -m "feat(verifier): detect resolved/unresolved/regressed after fix"
```

---

## Phase 7: 串接 (Wiring)

### Task 20: extension.ts — 啟動與命令

`Files:`
- Create: `src/extension.ts`

- [ ] `Step 1: 建立 extension.ts

```ts
// src/extension.ts — 擴充功能進入點。
import * as vscode from 'vscode';
import { collectDiagnostics } from './collector';
import { groupBySignature } from './dedup';
import { sortAndCap } from './grouper';
import { loadConfig, getApiKey, setApiKey } from './config';
import { PersistentQueue } from './queue';
import { Scheduler } from './scheduler';
import { createProvider } from './providers/factory';
import { fixOne } from './fixer';
import { applyOrConfirm, buildWorkspaceEdit } from './applier';
import { verifyFix } from './verifier';
import { log as reportLog, show as reportShow } from './report';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let queue: PersistentQueue;
let scheduler: Scheduler;
let output: vscode.OutputChannel;

const MAX_ATTEMPTS = 3;

async function snapshotFile(fsPath: string): Promise<string> {
  return readFile(fsPath, 'utf8');
}

async function restoreFile(fsPath: string, content: string): Promise<void> {
  await writeFile(fsPath, content, 'utf8');
}

async function showDiff(oldText: string, newText: string, uri: string): Promise<'apply' | 'reject'> {
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

async function processOneItem(): Promise<boolean> {
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
  const apiKey = await getApiKey(cfg.provider, (ctx as any).secrets);
  if (!apiKey) {
    reportLog(`missing API key for ${cfg.provider}, pausing queue`);
    return false;
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
  const beforeDiags = collectDiagnostics(() =>
    vscode.languages.getDiagnostics(vscode.Uri.parse(fix.uri)),
  );

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
    fetchAfter: async () =>
      collectDiagnostics(() =>
        vscode.languages.getDiagnostics(vscode.Uri.parse(fix.uri)),
      ),
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

let ctx: vscode.ExtensionContext;

export async function activate(context: vscode.ExtensionContext) {
  ctx = context;
  output = vscode.window.createOutputChannel('Log Doctor');
  queue = new PersistentQueue(context.workspaceState);
  queue.load();
  scheduler = new Scheduler(context.workspaceState, loadConfig().cooldownMinutes);

  context.subscriptions.push(
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
      const all = collectDiagnostics(() => vscode.languages.getDiagnostics());
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
      // 跑一輪;若冷卻中就停在這,使用者可以等下次
      await processOneItem();
      reportShow();
    }),
  );

  // 重啟接續:若佇列還有 pending 且冷卻已過,跑一輪
  if (scheduler.canRun() && queue.peek()) {
    await processOneItem();
  }
}

export function deactivate() {
  // 無後台 timer 要清;Scheduler 沒有 setTimeout
}
```

- [ ] `Step 2: 確認 tsc 編譯

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤。

- [ ] `Step 3: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add src/extension.ts
git commit -m "feat(extension): wire queue/scheduler/fixer/verifier into one command"
```

---

### Task 21: README — 使用說明

`Files:`
- Create: `README.md`

- [ ] `Step 1: 建立 README.md

````markdown
# Log Doctor

VSCode / Antigravity 擴充功能:手動命令掃描工作區 diagnostics,經 LLM 修復,低風險自動套用、高風險顯示 diff 由使用者確認。

## 使用

1. 安裝相依套件並 build:
   ```bash
   npm install
   npm run build
   ```
2. 在 VSCode 中按 F5 開 Extension Development Host。
3. 在 Extension Development Host 設定 API key (建議綁定為 SecretStorage):
   - 設定 `logDoctor.provider` 為 `claude` 或 `openai`
   - 設定 `logDoctor.model` 為你想用的模型 ID (預設 `claude-sonnet-4-6`)
   - 透過命令面板 (或測試) 把 key 寫入 SecretStorage:
     ```
     logDoctor.apiKey.claude  = sk-ant-...
     logDoctor.apiKey.openai  = sk-...
     ```
4. 觸發命令面板 → "Log Doctor: Fix Workspace Issues"。

## 設定

| 設定 | 預設 | 說明 |
|------|------|------|
| `logDoctor.provider` | `claude` | `claude` 或 `openai` |
| `logDoctor.model` | `claude-sonnet-4-6` | 模型 ID |
| `logDoctor.autoApplySources` | `["eslint","prettier","ruff","gofmt","stylelint"]` | 低風險來源 |
| `logDoctor.autoApplyMaxLines` | `3` | 自動套用最大淨新增行數 |
| `logDoctor.maxIssues` | `50` | 單次入列上限 |
| `logDoctor.cooldownMinutes` | `30` | 兩次實際套用間最短間隔 (分鐘) |

## 測試

```bash
npm test
```

整合測試需先 `npm run build` 再以 `@vscode/test-electron` 跑(後續補上)。

## 範圍

僅處理 `vscode.languages.getDiagnostics()` 取得的 diagnostics;task 純文字輸出不在 MVP 範圍內。
````

- [ ] `Step 2: 提交

```bash
cd /Users/shuk/projects/log_doctor
git add README.md
git commit -m "docs: README with usage, settings, and scope"
```

---

### Task 22: 全量測試

`Files:` none

- [ ] `Step 1: 跑所有單元測試

Run: `cd /Users/shuk/projects/log_doctor && npx vitest run`
Expected: 全部通過 (約 30+ 個 case)。

- [ ] `Step 2: 型別檢查

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p . --noEmit`
Expected: 沒有錯誤。

- [ ] `Step 3: build 出 out/

Run: `cd /Users/shuk/projects/log_doctor && npx tsc -p .`
Expected: 產生 `out/extension.js` 與 `out/**/*.js`。

- [ ] `Step 4: 提交 (若 build 改動 out 不入版)

```bash
cd /Users/shuk/projects/log_doctor
echo "out/" >> .gitignore   # 防漏
git add .gitignore
git commit -m "chore: ensure out/ is git-ignored"
```

---

### Task 23: 端到端手動煙霧測試 (Extension Development Host)

`Files:` none

- [ ] `Step 1: 開 VSCode 對本工作區

Run: `cd /Users/shuk/projects/log_doctor && code .`

- [ ] `Step 2: 按 F5 啟動 Extension Development Host

預期:新 VSCode 視窗開啟,標題列顯示 `[Extension Development Host]`。

- [ ] `Step 3: 在新視窗建立小工作區做煙霧測試

```bash
mkdir -p /tmp/log-doctor-smoke
cd /tmp/log-doctor-smoke
cat > index.js <<'EOF'
const x = 1;  // eslint-disable-line
function add(a,b){return a+b}
EOF
code /tmp/log-doctor-smoke
```

- [ ] `Step 4: 安裝 ESLint 擴充功能並讓它產生 diagnostics

在 Extension Development Host 裡:
1. 安裝 ESLint 擴充功能 (dbaeumer.vscode-eslint)
2. 視需要調整專案設定讓 ESLint 觸發警告
3. 把 `cooldownMinutes` 設為 `0` 方便測試 (Settings: `logDoctor.cooldownMinutes` = `0`)

- [ ] `Step 5: 設定 API key

在 Extension Development Host 開命令面板,執行 `Log Doctor: Set API Key`:
1. 跳出一個 password 輸入框,貼上你的 API key (例如 `sk-ant-...`)
2. 按 Enter
3. Output channel 應顯示 `setApiKey: stored key for claude`

Key 透過 `vscode.SecretStorage` 存於作業系統原生 keychain,不會寫進 `settings.json`。

- [ ] `Step 6: 執行 "Log Doctor: Fix Workspace Issues"

預期:
- Output channel "Log Doctor" 顯示 scan 結果與套用紀錄
- 若 ESLint 屬低風險,小修補會直接套上
- 若不是低風險,會跳確認對話框

- [ ] `Step 7: 驗收條件清單

- [ ] 掃描後 Output 顯示 group 數量與被丟棄的數量
- [ ] 低風險修補自動寫入檔案
- [ ] 高風險修補跳出確認
- [ ] 套用後 Output 顯示 resolved / unresolved / regressed
- [ ] 連續觸發第二次會被冷卻擋下 (除非 cooldownMinutes=0)

---

## 自我審查 (Self-Review)

- `Spec coverage`:
  - 一、目標 (Goal): 全部 Task 1–23 涵蓋
  - 二、訊號來源: Task 15 (collector)
  - 三、架構: Task 1–4 (skeleton + types) + 後續各模組
  - 四、命令與設定: Task 1 (manifest) + Task 8 (config) + Task 20 (command)
  - 五、執行模型: Task 20 (processOneItem) + Task 10 (scheduler) + Task 9 (queue) + Task 6 (dedup) + Task 5 (grouper) + Task 18 (risk → applier)
  - 六、錯誤處理: Task 20 (retries) + Task 14 (factory throws) + Task 19 (regression → revert)
  - 七、驗證迴圈: Task 19 (verifier) + Task 20 (回歸還原)
  - 八、測試策略: Task 4–19 各模組都有 vitest,Task 23 為手動煙霧
  - 九、範圍界線: Task 1 manifest 不含背景偵測,Task 15 不解析 task 純文字
- `Placeholders`: 已掃,沒有 "TBD" / "implement later" / "fill in details"
- `Type consistency`:
  - `DiagnosticInfo` 在 types / collector / dedup / grouper / risk / prompt / fixer / verifier 全部一致
  - `RepresentativeDiagnostic` 在 types / dedup / grouper / fixer / verifier 一致
  - `QueueItem.status` 在 queue / extension 一致
  - `FixProposal` 在 types / prompt / fixer / applier 一致
  - `Provider.send` 簽名: `(system, user, signal?) => Promise<string>` 在 claude / openai / factory 一致
  - `Scheduler.canRun(now?)` / `msUntilNextRun(now?)` / `markApplied(now?)` 簽名在測試與實作一致
  - `applyOrConfirm` 的 input 形狀在測試與實作一致
