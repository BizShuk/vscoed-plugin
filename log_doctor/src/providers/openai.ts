// src/providers/openai.ts — OpenAI provider。
import OpenAI from 'openai';
import { Provider } from './provider';
import { ProviderName } from '../types';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  maxTokens?: number;
}

export class OpenAIProvider implements Provider {
  readonly name: ProviderName = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: OpenAIProviderOptions) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 2048;
  }

  async send(system: string, user: string, signal?: AbortSignal): Promise<string> {
    const params = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: user },
      ],
    };
    const res = signal
      ? await this.client.chat.completions.create(params, { signal })
      : await this.client.chat.completions.create(params);
    const choice = res.choices[0];
    if (!choice?.message?.content) {
      throw new Error('OpenAI returned no choice content');
    }
    return choice.message.content;
  }
}
