import { describe, it, expect } from 'vitest';
import {
  healToolCallArguments,
  sanitizeToolSchemasForUpstream,
  getDefaultValueForProperty,
  type ToolDefinition,
} from '../src/application/tool-auto-healer.js';

describe('ToolAutoHealer & Schema Sanitizer', () => {
  it('infills missing required properties for pwsh command tool', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'pwsh',
        description: 'Run powershell command',
        input_schema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to run' },
            description: { type: 'string', description: 'Explanation of action' },
          },
          required: ['command', 'description'],
        },
      },
    ];

    const raw = '{"command": "dir"}';
    const healed = healToolCallArguments('pwsh', raw, tools);

    expect(healed.wasHealed).toBe(true);
    expect(healed.parsed).toEqual({
      command: 'dir',
      description: '',
    });
  });

  it('infills missing pattern and path for glob tool', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'glob',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
          },
          required: ['pattern', 'path'],
        },
      },
    ];

    const raw = '{}';
    const healed = healToolCallArguments('glob', raw, tools);

    expect(healed.wasHealed).toBe(true);
    expect(healed.parsed).toEqual({
      pattern: '*',
      path: '.',
    });
  });

  it('sanitizes tool schemas for upstream models by relaxing metadata required fields', () => {
    const tools = [
      {
        type: 'function',
        function: {
          name: 'pwsh',
          description: 'Run command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              description: { type: 'string' },
              toolAction: { type: 'string' },
              timeout: { type: 'number' },
            },
            required: ['command', 'description', 'toolAction', 'timeout'],
          },
        },
      },
    ];

    const sanitized = sanitizeToolSchemasForUpstream(tools);
    const req = (sanitized[0] as any).function?.parameters?.required;

    expect(req).toEqual(['command']);
    expect(req).not.toContain('description');
    expect(req).not.toContain('toolAction');
    expect(req).not.toContain('timeout');
  });

  it('heals trailing-comma JSON and infills missing fields', () => {
    const tools: ToolDefinition[] = [
      {
        name: 'read',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    ];

    // Trailing comma is invalid JSON but repairJson strips it
    const raw = '{"path": "src/index.ts",}';
    const healed = healToolCallArguments('read', raw, tools);

    expect(healed.wasHealed).toBe(true);
    expect(healed.parsed).toEqual({ path: 'src/index.ts' });
  });

  it('returns sane defaults for unknown tool with empty args', () => {
    const result = getDefaultValueForProperty('grep', 'query', { type: 'string' });
    expect(result).toBe('.');
  });

  it('respects schema-level default over type fallback', () => {
    const result = getDefaultValueForProperty('mytool', 'limit', { type: 'number', default: 100 });
    expect(result).toBe(100);
  });
});