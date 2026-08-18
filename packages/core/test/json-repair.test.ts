import { describe, it, expect } from 'vitest';
import { repairJson, repairToolCallArguments } from '../src/application/json-repair.js';

describe('JsonRepair: Self-Healing JSON Engine', () => {
  it('passes through valid JSON untouched', () => {
    const valid = '{"name": "agent-nexus", "port": 8787, "active": true}';
    const result = repairJson(valid);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(false);
    expect(result.repaired).toBe(valid);
    expect(result.parsed).toEqual({ name: 'agent-nexus', port: 8787, active: true });
  });

  it('strips markdown code fences', () => {
    const fenced = '```json\n{"status": "ok", "count": 42}\n```';
    const result = repairJson(fenced);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(true);
    expect(result.parsed).toEqual({ status: 'ok', count: 42 });
  });

  it('strips leading conversational chatter before JSON', () => {
    const chatter = 'Here is the requested tool payload:\n{"action": "create_file", "path": "/app/index.ts"}';
    const result = repairJson(chatter);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(true);
    expect(result.parsed).toEqual({ action: 'create_file', path: '/app/index.ts' });
  });

  it('removes trailing commas from objects and arrays', () => {
    const trailing = '{"items": ["a", "b", "c",], "meta": {"debug": true,}, }';
    const result = repairJson(trailing);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(true);
    expect(result.parsed).toEqual({ items: ['a', 'b', 'c'], meta: { debug: true } });
  });

  it('normalizes single-quoted keys and strings', () => {
    const singleQuotes = "{'user': 'alice', 'role': 'admin'}";
    const result = repairJson(singleQuotes);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(true);
    expect(result.parsed).toEqual({ user: 'alice', role: 'admin' });
  });

  it('auto-closes truncated brackets and braces', () => {
    const truncated = '{"tasks": [{"id": 1, "title": "Setup Nexus"}';
    const result = repairJson(truncated);
    expect(result.isValidJson).toBe(true);
    expect(result.wasRepaired).toBe(true);
    expect(result.parsed).toEqual({ tasks: [{ id: 1, title: 'Setup Nexus' }] });
  });

  it('repairs tool call arguments safely', () => {
    const rawToolArgs = '```json\n{"command": "git status", "timeout": 5000,}\n```';
    const repaired = repairToolCallArguments(rawToolArgs);
    expect(JSON.parse(repaired)).toEqual({ command: 'git status', timeout: 5000 });
  });
});
