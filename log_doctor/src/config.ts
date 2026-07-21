// src/config.ts — 讀設定 + 從 SecretStorage 取 API key。
import * as vscode from 'vscode';
import { ConfigSnapshot, ListenerRule, ProviderName } from './types';

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
    listeners: cfg.get<ListenerRule[]>('listeners', []) ?? [],
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
