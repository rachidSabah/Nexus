import { describe, expect, it } from 'vitest';
import { PromptCompressor } from '../src/application/prompt-compressor.js';
import type { ChatCompletionRequest } from '../src/domain/types.js';

const baseReq = (messages: ChatCompletionRequest['messages'], tools?: ChatCompletionRequest['tools']): ChatCompletionRequest => ({
  model: 'nexus/auto',
  messages,
  ...(tools ? { tools } : {}),
});

describe('PromptCompressor — profile-aware Deep Token Optimization', () => {
  it('default activeProfile is "none" → exact pass-through (no behavior change on existing installs)', async () => {
    const compressor = new PromptCompressor(); // default activeProfile: 'none'
    const req = baseReq([{ role: 'user', content: 'a\n\n\n\n\nb' }]);
    const res = await compressor.compress(req);
    expect(res.request).toBe(req);
    expect(res.tokensSaved).toBe(0);
    expect(res.originalChars).toBe(res.compressedChars);
  });

  it('safe-stack normalizes excessive multi-line blank runs while preserving indentation', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'safe-stack' });
    const req = baseReq([{ role: 'user', content: 'def foo():\n    x = 1\n\n\n\n\n    return x\n' }]);
    const res = await compressor.compress(req);
    expect(res.request.messages[0]!.content).toBe('def foo():\n    x = 1\n\n    return x\n');
    expect(res.tokensSaved).toBeGreaterThan(0);
    expect(res.strategies).toContain('whitespace_normalization');
  });

  it('safe-stack deduplicates consecutive identical system prompts', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'safe-stack' });
    const req = baseReq([
      { role: 'system', content: 'You are an expert coding assistant.' },
      { role: 'system', content: 'You are an expert coding assistant.' },
      { role: 'user', content: 'Build a Next.js app' },
    ]);
    const res = await compressor.compress(req);
    expect(res.request.messages.length).toBe(2);
    expect(res.request.messages[0]!.role).toBe('system');
    expect(res.request.messages[1]!.role).toBe('user');
    expect(res.strategies).toContain('system_prompt_dedup');
  });

  it('safe-stack prunes schema noise without damaging parameter definitions', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'safe-stack' });
    const req = baseReq([{ role: 'user', content: 'Call tool' }], [
      {
        type: 'function',
        function: {
          name: 'execute_command',
          description: 'Executes a command',
          parameters: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            title: 'CommandArgs',
            type: 'object',
            additionalProperties: false,
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      },
    ]);
    const res = await compressor.compress(req);
    const fn = (res.request.tools![0] as any).function;
    expect(fn.parameters.$schema).toBeUndefined();
    expect(fn.parameters.title).toBeUndefined();
    expect(fn.parameters.properties.command.type).toBe('string');
    expect(res.strategies).toContain('schema_compression');
  });

  it('safe-stack does NOT run toolOutputCompaction (strictly lossless per spec §4)', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'safe-stack' });
    const hugeLog = 'Running build...\n' + 'Compiling module chunk...\n'.repeat(300) + 'Build failed with code 1\nError: Syntax error';
    const req = baseReq([
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'Run the build' },
      { role: 'assistant', content: 'Running build tool' },
      { role: 'tool', content: hugeLog },
      { role: 'user', content: 'What is the error?' },
    ]);
    const res = await compressor.compress(req);
    const toolMsg = res.request.messages.find((m) => m.role === 'tool')!;
    // Under safe-stack the tool output MUST remain intact (no compaction marker).
    expect((toolMsg.content as string)).not.toContain('Nexus Token Optimizer');
    expect((toolMsg.content as string)).toContain('Build failed with code 1');
  });

  it('compactOlderToolOutputs engine is retained and functional (available for future aggressive toggle)', () => {
    const compressor = new PromptCompressor({ activeProfile: 'none' });
    const hugeLog = 'Running build...\n' + 'Compiling module chunk...\n'.repeat(300) + 'Build failed with code 1\nError: Syntax error';
    const messages = [
      { role: 'system' as const, content: 'System instruction' },
      { role: 'user' as const, content: 'Run the build' },
      { role: 'assistant' as const, content: 'Running build tool' },
      { role: 'tool' as const, content: hugeLog },
      { role: 'user' as const, content: 'recent tool log 123' },
      { role: 'assistant' as const, content: 'Checking...' },
      { role: 'tool' as const, content: 'recent tool log 456' },
    ];
    const compacted = compressor.compactOlderToolOutputs(messages);
    const oldTool = compacted[3]!;
    expect((oldTool.content as string)).toContain('Nexus Token Optimizer');
    expect((oldTool.content as string)).toContain('Running build');
    expect((oldTool.content as string)).toContain('Error: Syntax error');
    // Recent tool message in active window is untouched
    expect((compacted[6]!.content as string)).toBe('recent tool log 456');
  });

  it('runtime profile switch via updateConfig is honored and invalid profiles are ignored', () => {
    const compressor = new PromptCompressor({ activeProfile: 'none' });
    compressor.updateConfig({ activeProfile: 'safe-stack' });
    expect(compressor.getConfig().activeProfile).toBe('safe-stack');
    // Invalid profile must be rejected without throwing or coercing.
    compressor.updateConfig({ activeProfile: 'bogus' as never });
    expect(compressor.getConfig().activeProfile).toBe('safe-stack');
    compressor.updateConfig({ activeProfile: 'none' });
    expect(compressor.getConfig().activeProfile).toBe('none');
  });

  it('emits measured (not fabricated) character savings for safe-stack', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'safe-stack' });
    const req = baseReq([
      { role: 'system', content: 'You are an expert coding assistant.' },
      { role: 'system', content: 'You are an expert coding assistant.' },
      { role: 'user', content: 'Build a Next.js app\n\n\n\n\nwith routes' },
    ]);
    const res = await compressor.compress(req);
    expect(res.originalChars).toBeGreaterThan(0);
    expect(res.compressedChars).toBeGreaterThan(0);
    expect(res.compressedChars).toBeLessThanOrEqual(res.originalChars);
    expect(res.tokensSaved).toBe(Math.round((res.originalChars - res.compressedChars) / 4));
  });

  it('caveman / rtk are no-ops when no external upstream is registered (fail-open, 0 savings)', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'caveman' });
    const req = baseReq([{ role: 'user', content: 'hello world, this is a reasonably long prompt to measure' }]);
    const res = await compressor.compress(req);
    // No external compressor registered → content unchanged, 0 savings.
    expect(res.request.messages[0]!.content).toBe(req.messages[0]!.content);
    expect(res.tokensSaved).toBe(0);
    expect(res.originalChars).toBe(res.compressedChars);
  });

  it('ponytail is a no-op (behavioral ruleset, not a prompt transform)', async () => {
    const compressor = new PromptCompressor({ activeProfile: 'ponytail' });
    const req = baseReq([{ role: 'user', content: 'do something' }]);
    const res = await compressor.compress(req);
    expect(res.request.messages[0]!.content).toBe(req.messages[0]!.content);
    expect(res.tokensSaved).toBe(0);
  });
});
