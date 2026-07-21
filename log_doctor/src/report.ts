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
