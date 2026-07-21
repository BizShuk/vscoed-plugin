// src/providers/claude.ts — Anthropic Claude provider。
import Anthropic from '@anthropic-ai/sdk';
import { Provider } from './provider';
import { ProviderName } from '../types';

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export class ClaudeProvider implements Provider {
  readonly name: ProviderName = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: ClaudeProviderOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 2048;
  }

  async send(system: string, user: string, signal?: AbortSignal): Promise<string> {
    const params = {
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: 'user' as const, content: user }],
    };
    const res = signal
      ? await this.client.messages.create(params, { signal })
      : await this.client.messages.create(params);
    const block = res.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      throw new Error('Claude returned no text block');
    }
    return block.text;
  }
}
