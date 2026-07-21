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
  listeners: ListenerRule[];
}

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
