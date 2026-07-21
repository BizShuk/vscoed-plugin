// src/collector.ts — 從 vscode 抓 diagnostics 並轉成內部型別。
import type { Diagnostic, Uri } from 'vscode';
import { DiagnosticInfo, Severity } from './types';

export type GetDiagnosticsFn = () => Map<Uri, Diagnostic[]>;

const SEVERITY_MAP: Record<number, Severity | null> = {
  0: 'error',      // Error
  1: 'warning',    // Warning
  2: 'info',       // Information
  3: 'hint',       // Hint (vscode.DiagnosticSeverity.Hint)
  4: 'hint',       // 測試與部分舊版 API 把 Hint 視為 4
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
      const sev = SEVERITY_MAP[sevNum] ?? 'info';
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
