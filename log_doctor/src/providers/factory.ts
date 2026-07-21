// src/providers/factory.ts — 依 ConfigSnapshot 與 API key 挑 provider。
import { ConfigSnapshot } from '../types';
import { ClaudeProvider } from './claude';
import { OpenAIProvider } from './openai';
import { Provider } from './provider';

export function createProvider(cfg: ConfigSnapshot, apiKey: string): Provider {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Log Doctor: API key is empty. Set it via SecretStorage.');
  }
  switch (cfg.provider) {
    case 'claude':
      return new ClaudeProvider({ apiKey, model: cfg.model });
    case 'openai':
      return new OpenAIProvider({ apiKey, model: cfg.model });
    default:
      throw new Error(`Log Doctor: unsupported provider "${cfg.provider}"`);
  }
}
