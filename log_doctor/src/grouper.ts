// src/grouper.ts — 純邏輯,排序 + 裁切。
import { RepresentativeDiagnostic, Severity } from './types';

const SEVERITY_RANK: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
  hint: 3,
};

/**
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
