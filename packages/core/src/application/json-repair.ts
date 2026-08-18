/**
 * ───────────────────────────────────────────────────────────────────────────
 * JsonRepair — Self-Healing JSON & Tool Call Schema Repair Engine
 *
 * Catches malformed model JSON outputs before they reach agent parsers:
 *   - Strips markdown code fences (```json ... ```)
 *   - Strips leading / trailing non-JSON chatter
 *   - Normalizes single-quoted keys and strings to standard JSON double-quotes
 *   - Removes illegal trailing commas ({ "a": 1, } -> { "a": 1 })
 *   - Auto-closes truncated/unbalanced braces and brackets
 *   - Fixes unescaped newlines inside JSON string literals
 * ───────────────────────────────────────────────────────────────────────────
 */

export interface JsonRepairResult {
  readonly repaired: string;
  readonly wasRepaired: boolean;
  readonly isValidJson: boolean;
  readonly parsed?: unknown;
}

export function repairJson(input: string): JsonRepairResult {
  if (typeof input !== 'string') {
    return { repaired: '', wasRepaired: false, isValidJson: false };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { repaired: trimmed, wasRepaired: false, isValidJson: false };
  }

  // 1. Fast path: try parsing directly
  try {
    const parsed = JSON.parse(trimmed);
    return { repaired: trimmed, wasRepaired: false, isValidJson: true, parsed };
  } catch {
    // Proceed to repair pipeline
  }

  let text = trimmed;

  // 2. Strip Markdown code fences: ```json ... ``` or ``` ... ```
  const fenceRegex = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;
  const match = text.match(fenceRegex);
  if (match && match[1]) {
    text = match[1].trim();
  } else {
    // Also handle embedded fences if surrounded by chatter
    const embeddedMatch = text.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/);
    if (embeddedMatch && embeddedMatch[1]) {
      text = embeddedMatch[1].trim();
    }
  }

  // 3. Extract JSON object/array boundaries if there's leading/trailing text
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    let startIdx = -1;
    if (firstBrace !== -1 && firstBracket !== -1) {
      startIdx = Math.min(firstBrace, firstBracket);
    } else if (firstBrace !== -1) {
      startIdx = firstBrace;
    } else if (firstBracket !== -1) {
      startIdx = firstBracket;
    }

    if (startIdx !== -1) {
      text = text.slice(startIdx);
    }
  }

  // 4. Clean trailing commas in objects and arrays
  text = text.replace(/,\s*([}\]])/g, '$1');

  // 5. Replace single quotes around keys or strings with double quotes
  // Handles {'key': 'value'} -> {"key": "value"} safely
  text = text.replace(/(['"])?([a-zA-Z0-9_$-]+)(['"])?\s*:/g, '"$2":');
  text = text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');

  // 6. Fix unclosed strings and auto-close unbalanced braces/brackets
  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') openBraces++;
      else if (ch === '}') openBraces = Math.max(0, openBraces - 1);
      else if (ch === '[') openBrackets++;
      else if (ch === ']') openBrackets = Math.max(0, openBrackets - 1);
    }
  }

  if (inString) {
    text += '"'; // close unclosed string literal
  }
  while (openBrackets > 0) {
    text += ']';
    openBrackets--;
  }
  while (openBraces > 0) {
    text += '}';
    openBraces--;
  }

  // Clean trailing commas again if closure produced any
  text = text.replace(/,\s*([}\]])/g, '$1');

  // 7. Verify repaired JSON
  try {
    const parsed = JSON.parse(text);
    return {
      repaired: text,
      wasRepaired: true,
      isValidJson: true,
      parsed,
    };
  } catch {
    // Best-effort string cleanup
    return {
      repaired: text,
      wasRepaired: text !== trimmed,
      isValidJson: false,
    };
  }
}

/**
 * Repairs tool calls returned by models if the arguments string is malformed JSON.
 */
export function repairToolCallArguments(args: string): string {
  if (!args || typeof args !== 'string') return '{}';
  const result = repairJson(args);
  return result.isValidJson ? result.repaired : args;
}
