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

/**
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
