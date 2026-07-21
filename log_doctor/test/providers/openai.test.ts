import { describe, it, expect, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create: createMock } },
    })),
  };
});

import { OpenAIProvider } from '../../src/providers/openai';

describe('OpenAIProvider', () => {
  it('calls chat.completions.create with system + user messages', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"fixes":[]}' } }],
    });
    const p = new OpenAIProvider({ apiKey: 'sk-test', model: 'gpt-4o' });
    const out = await p.send('SYS', 'USR');
    expect(out).toBe('{"fixes":[]}');
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'USR' },
        ],
      }),
    );
  });

  it('throws when no choice returned', async () => {
    createMock.mockResolvedValueOnce({ choices: [] });
    const p = new OpenAIProvider({ apiKey: 'sk', model: 'm' });
    await expect(p.send('S', 'U')).rejects.toThrow(/no choice/i);
  });
});
