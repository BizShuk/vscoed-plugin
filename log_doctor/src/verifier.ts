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
