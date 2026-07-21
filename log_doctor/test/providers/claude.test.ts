import { describe, it, expect, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
  };
});

import { ClaudeProvider } from '../../src/providers/claude';

describe('ClaudeProvider', () => {
  it('calls messages.create with system and user messages', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: '{"fixes":[]}' }],
    });
    const p = new ClaudeProvider({ apiKey: 'sk-test', model: 'claude-sonnet-4-6' });
    const out = await p.send('SYS', 'USR');
    expect(out).toBe('{"fixes":[]}');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: 'SYS',
        messages: [{ role: 'user', content: 'USR' }],
      }),
    );
  });

  it('propagates errors from the SDK', async () => {
    createMock.mockRejectedValueOnce(new Error('boom'));
    const p = new ClaudeProvider({ apiKey: 'sk', model: 'm' });
    await expect(p.send('S', 'U')).rejects.toThrow('boom');
  });
});
