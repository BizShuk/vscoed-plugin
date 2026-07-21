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
