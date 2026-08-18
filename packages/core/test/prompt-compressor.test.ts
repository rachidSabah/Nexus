import { describe, expect, it } from 'vitest';
import { PromptCompressor } from '../src/application/prompt-compressor.js';
import type { ChatCompletionRequest } from '../src/domain/types.js';

describe('PromptCompressor — Deep Token Optimization & Fine-Tuning', () => {
  it('normalizes excessive multi-line blank runs while preserving indentation', () => {
    const compressor = new PromptCompressor();
    const req: ChatCompletionRequest = {
      model: 'nexus/auto',
      messages: [
        {
          role: 'user',
          content: 'def foo():\n    x = 1\n\n\n\n\n    return x\n',
        },
      ],
    };

    const res = compressor.compress(req);
    expect(res.request.messages[0]!.content).toBe('def foo():\n    x = 1\n\n    return x\n');
    expect(res.tokensSaved).toBeGreaterThan(0);
  });

  it('deduplicates consecutive identical system prompts', () => {
    const compressor = new PromptCompressor();
    const req: ChatCompletionRequest = {
      model: 'nexus/auto',
      messages: [
        { role: 'system', content: 'You are an expert coding assistant.' },
        { role: 'system', content: 'You are an expert coding assistant.' },
        { role: 'user', content: 'Build a Next.js app' },
      ],
    };

    const res = compressor.compress(req);
    expect(res.request.messages.length).toBe(2);
    expect(res.request.messages[0]!.role).toBe('system');
    expect(res.request.messages[1]!.role).toBe('user');
  });

  it('compacts older massive tool output dumps while keeping recent turns intact', () => {
    const compressor = new PromptCompressor();
    const hugeLog = 'Running build...\n' + 'Compiling module chunk...\n'.repeat(300) + 'Build failed with code 1\nError: Syntax error';
    const req: ChatCompletionRequest = {
      model: 'nexus/auto',
      messages: [
        { role: 'system', content: 'System instruction' },
        { role: 'user', content: 'Run the build' },
        { role: 'assistant', content: 'Running build tool' },
        { role: 'tool', content: hugeLog },
        { role: 'user', content: 'What is the error?' },
        { role: 'assistant', content: 'Checking...' },
        { role: 'tool', content: 'recent tool log 123' },
      ],
    };

    const res = compressor.compress(req);
    const compactedTool = res.request.messages[3]!;
    expect(compactedTool.content).toContain('Nexus Token Optimizer');
    expect(compactedTool.content).toContain('Running build');
    expect(compactedTool.content).toContain('Error: Syntax error');

    // Recent tool message in active window is untouched
    const recentTool = res.request.messages[6]!;
    expect(recentTool.content).toBe('recent tool log 123');
  });

  it('prunes schema noise without damaging parameter definitions', () => {
    const compressor = new PromptCompressor();
    const req: ChatCompletionRequest = {
      model: 'nexus/auto',
      messages: [{ role: 'user', content: 'Call tool' }],
      tools: [
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
              properties: {
                command: { type: 'string' },
              },
              required: ['command'],
            },
          },
        },
      ],
    };

    const res = compressor.compress(req);
    const fn = (res.request.tools![0] as any).function;
    expect(fn.parameters.$schema).toBeUndefined();
    expect(fn.parameters.title).toBeUndefined();
    expect(fn.parameters.properties.command.type).toBe('string');
  });
});
