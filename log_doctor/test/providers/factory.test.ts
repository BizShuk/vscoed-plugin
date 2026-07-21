import { describe, it, expect, vi, beforeEach } from 'vitest';

const { claudeCtor, openaiCtor } = vi.hoisted(() => ({
  claudeCtor: vi.fn(),
  openaiCtor: vi.fn(),
}));

vi.mock('../../src/providers/claude', () => ({
  ClaudeProvider: claudeCtor,
}));
vi.mock('../../src/providers/openai', () => ({
  OpenAIProvider: openaiCtor,
}));

import { createProvider } from '../../src/providers/factory';
import { ConfigSnapshot } from '../../src/types';

const base: ConfigSnapshot = {
  provider: 'claude',
  model: 'm',
  autoApplySources: [],
  autoApplyMaxLines: 3,
  maxIssues: 50,
  cooldownMinutes: 30,
  listeners: [],
};

describe('createProvider', () => {
  beforeEach(() => {
    claudeCtor.mockClear();
    openaiCtor.mockClear();
  });

  it('returns ClaudeProvider when provider=claude', () => {
    createProvider({ ...base, provider: 'claude' }, 'sk-x');
    expect(claudeCtor).toHaveBeenCalledWith({ apiKey: 'sk-x', model: 'm' });
    expect(openaiCtor).not.toHaveBeenCalled();
  });

  it('returns OpenAIProvider when provider=openai', () => {
    createProvider({ ...base, provider: 'openai' }, 'sk-y');
    expect(openaiCtor).toHaveBeenCalledWith({ apiKey: 'sk-y', model: 'm' });
    expect(claudeCtor).not.toHaveBeenCalled();
  });

  it('throws when apiKey is empty', () => {
    expect(() => createProvider(base, '')).toThrow(/api key/i);
  });
});
