import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((key: string, def: unknown) => {
        const map: Record<string, unknown> = {
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          autoApplySources: ['eslint', 'prettier'],
          autoApplyMaxLines: 5,
          maxIssues: 20,
          cooldownMinutes: 10,
        };
        return key in map ? map[key] : def;
      }),
    })),
  },
  SecretStorage: class {},
}));

import { loadConfig, getApiKey } from '../src/config';

describe('loadConfig', () => {
  it('returns a fully populated snapshot', () => {
    const snap = loadConfig();
    expect(snap).toEqual({
      provider: 'claude',
      model: 'claude-sonnet-4-6',
      autoApplySources: ['eslint', 'prettier'],
      autoApplyMaxLines: 5,
      maxIssues: 20,
      cooldownMinutes: 10,
      listeners: [],
    });
  });
});

describe('getApiKey', () => {
  it('returns key from SecretStorage for the active provider', async () => {
    const get = vi.fn().mockResolvedValue('sk-test');
    const key = await getApiKey('claude', { get, store: vi.fn() } as any);
    expect(key).toBe('sk-test');
    expect(get).toHaveBeenCalledWith('logDoctor.apiKey.claude');
  });

  it('returns undefined when key missing', async () => {
    const get = vi.fn().mockResolvedValue(undefined);
    const key = await getApiKey('claude', { get, store: vi.fn() } as any);
    expect(key).toBeUndefined();
  });
});
