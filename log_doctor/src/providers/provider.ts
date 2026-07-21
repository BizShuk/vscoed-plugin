// src/providers/provider.ts — LLM provider 抽象。
import { FixProposal, ProviderName } from '../types';

export interface Provider {
  readonly name: ProviderName;
  send(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

/** 從 provider 文字回傳解析出 fix proposals;薄封裝避免每處重複 try/catch。 */
import { parseFixResponse } from '../prompt';

export async function sendForFixes(
  provider: Provider,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<{ fixes: FixProposal[]; error?: string }> {
  const raw = await provider.send(system, user, signal);
  return parseFixResponse(raw);
}
