// src/dedup.ts — 純邏輯,計算每個 diagnostic 的正規化簽名並分組。
import { createHash } from 'node:crypto';
import { DiagnosticInfo, RepresentativeDiagnostic } from './types';

/** 把 diagnostic 訊息裡會變動的片段去掉,只留下根因樣貌。 */
export function normalizeMessage(message: string): string {
  return message
    // 單引號 / 雙引號 / 反引號 包住的識別字 → <ID>
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '<ID>')
    // Unix / Windows 絕對路徑,順便吃掉後面的 :NN 行:列
    .replace(/\/(?:Users|home|var|tmp|opt|etc)\/(?:[^:\s]|:(?!\d+))+(?::\d+)?/g, '<PATH>')
    .replace(/[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+(?::\d+)?/g, '<PATH>')
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
