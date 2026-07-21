// src/extension.ts — VSCode 擴充功能進入點 (root orchestrator)。
//
// `vscode-plugin-experiment` 是 multi-feature 擴充:此檔負責 Extension Host
// 進入點契約 (`activate` / `deactivate`),本身不含任何 feature 邏輯。各 feature
// 透過子資料夾 (`log_doctor/` 等) 提供 `register*` 函式,本檔依序呼叫完成編排。
//
// 新增 feature 時:
//  1. 在 `<feature_name>/src/register.ts` 定義 `export function register<Name>(context)`
//  2. 在下方 `registerLogDoctor(...)` 後加入 `register<Name>(context)` 呼叫
//  3. 在 `package.json` 的 `activationEvents` 與 `contributes.commands` 註冊對應命令

import * as vscode from 'vscode';
import { registerLogDoctor } from '../log_doctor/src/register';

export async function activate(context: vscode.ExtensionContext) {
  // 各 feature 註冊入口在此呼叫。每個 register 函式內部以 try/catch 包裹
  // init 邏輯,確保單一 feature 失敗不會讓整個擴充掛掉。
  await registerLogDoctor(context);

  // 未來新增 feature 範例:
  // await registerFormatter(context);
  // await registerSnippetManager(context);
}

export function deactivate() {
  // 各 feature 透過 `context.subscriptions.push(...)` 註冊的命令與監聽器,
  // 會在 Extension Host 卸載時自動清理,這裡不需要手動處理。
}