/**
 * tool-auto-healer.ts
 *
 * Tool Schema Auto-Healing and Default Infill.
 * - healToolCallArguments: parses/repairs JSON tool arguments and infills
 *   sane defaults for missing required properties before returning to CLI harness.
 * - sanitizeToolSchemasForUpstream: strips metadata-only fields from the
 *   "required" arrays in tool schemas sent to non-Anthropic upstream models.
 */

import { repairJson } from './json-repair.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  default?: unknown;
  description?: string;
  [key: string]: unknown;
}

export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema?: JsonSchema;
  parameters?: JsonSchema;
}

export interface OpenAIToolDefinition {
  type?: 'function';
  function?: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
  };
}

export type ToolDefinition = AnthropicToolDefinition | OpenAIToolDefinition;

export interface HealResult {
  wasHealed: boolean;
  parsed: Record<string, unknown>;
  serialized: string;
}

// ---------------------------------------------------------------------------
// Metadata fields stripped from "required" when sending to upstream models
// ---------------------------------------------------------------------------

const METADATA_REQUIRED_STRIP = new Set([
  'description', 'explanation', 'thought',
  'toolAction', 'toolSummary',
  'timeout', 'wait_ms', 'waitMs', 'WaitMsBeforeAsync',
  'notes', 'reason', 'rationale',
]);

// ---------------------------------------------------------------------------
// getDefaultValueForProperty
// ---------------------------------------------------------------------------

export function getDefaultValueForProperty(
  toolName: string,
  propName: string,
  schema: JsonSchema,
): unknown {
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];

  const tool = toolName.toLowerCase();
  const prop = propName.toLowerCase();

  if (prop === 'description' || prop === 'explanation' || prop === 'thought') return '';
  if (prop === 'toolaction' || prop === 'toolsummary') return '';
  if (prop === 'timeout' || prop === 'wait_ms' || prop === 'waitms') return 0;
  if (prop === 'pattern') return '*';
  if (prop === 'path' || prop === 'filepath' || prop === 'file_path') {
    return (tool === 'glob' || tool === 'find_by_name') ? '.' : './';
  }
  if (prop === 'command' || prop === 'commandline') return '';
  if (prop === 'query' || prop === 'searchpath' || prop === 'search_path') return '.';
  if (prop === 'startline' || prop === 'start_line') return 1;
  if (prop === 'endline' || prop === 'end_line') return 1;
  if (prop === 'cwd') return '.';

  const type = schema.type ?? 'string';
  if (type === 'string') return '';
  if (type === 'number' || type === 'integer') return 0;
  if (type === 'boolean') return false;
  if (type === 'array') return [];
  if (type === 'object') return {};
  return '';
}

// ---------------------------------------------------------------------------
// healToolCallArguments
// ---------------------------------------------------------------------------

export function healToolCallArguments(
  toolName: string,
  rawArgs: string,
  tools?: readonly unknown[],
): HealResult {
  const schema = resolveSchema(toolName, tools);

  let parsed: Record<string, unknown>;
  let wasHealed = false;

  try {
    parsed = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    // repairJson returns a JsonRepairResult object
    const repairResult = repairJson(rawArgs);
    if (repairResult.isValidJson && repairResult.parsed !== null && typeof repairResult.parsed === 'object') {
      parsed = repairResult.parsed as Record<string, unknown>;
      wasHealed = true;
    } else {
      parsed = {};
      wasHealed = true;
    }
  }

  if (schema?.required && schema.properties) {
    for (const propName of schema.required) {
      if (parsed[propName] === undefined) {
        const propSchema = schema.properties[propName] ?? {};
        parsed[propName] = getDefaultValueForProperty(toolName, propName, propSchema);
        wasHealed = true;
      }
    }
  }

  const serialized = JSON.stringify(parsed);
  return { wasHealed, parsed, serialized };
}

// ---------------------------------------------------------------------------
// sanitizeToolSchemasForUpstream
// ---------------------------------------------------------------------------

export function sanitizeToolSchemasForUpstream<T extends ToolDefinition>(
  tools: T[] | undefined,
): T[] {
  if (!tools || tools.length === 0) return tools ?? [];

  return tools.map((tool) => {
    const cloned = JSON.parse(JSON.stringify(tool)) as T;

    const oai = cloned as OpenAIToolDefinition;
    if (oai.function?.parameters?.required) {
      oai.function.parameters.required = filterRequired(oai.function.parameters);
    }

    const anth = cloned as AnthropicToolDefinition;
    if (anth.input_schema?.required) {
      anth.input_schema.required = filterRequired(anth.input_schema);
    }
    if (anth.parameters?.required) {
      anth.parameters.required = filterRequired(anth.parameters);
    }

    return cloned;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveSchema(toolName: string, tools?: readonly unknown[]): JsonSchema | undefined {
  for (const tool of tools ?? []) {
    const oai = tool as OpenAIToolDefinition;
    if (oai.function?.name === toolName && oai.function.parameters) {
      return oai.function.parameters;
    }
    const anth = tool as AnthropicToolDefinition;
    if (anth.name === toolName) {
      return anth.input_schema ?? anth.parameters;
    }
  }
  return undefined;
}

function filterRequired(schema: JsonSchema): string[] {
  const props = schema.properties;
  return (schema.required ?? []).filter((field) => {
    if (METADATA_REQUIRED_STRIP.has(field)) return false;
    if (props && !(field in props)) return false;
    return true;
  });
}
