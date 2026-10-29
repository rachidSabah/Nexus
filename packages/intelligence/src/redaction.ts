/**
 * Secret redaction gate (blueprint §6, §10).
 *
 * Every string that enters the intelligence store from an untrusted source is
 * scrubbed here BEFORE it is logged, indexed, analysed or sent to any AI model.
 *
 * Rules:
 *   - Suspected credential values are replaced with a stable category marker.
 *   - The raw value is never stored — and is NEVER hashed either: fingerprints
 *     of secrets are themselves sensitive correlation data.
 *   - String length is capped and array sizes bounded so poisoned sources
 *     cannot bloat evidence archives.
 *   - Redaction reports what happened (categories + counts) so reviewers can
 *     audit the transformation without seeing the secret.
 */

export const REDACTIONS = {
  openaiStyleKey: '<REDACTED:openai-style-key>',
  anthropicKey: '<REDACTED:anthropic-key>',
  githubToken: '<REDACTED:github-token>',
  googleApiKey: '<REDACTED:google-api-key>',
  huggingfaceToken: '<REDACTED:huggingface-token>',
  awsAccessKey: '<REDACTED:aws-access-key>',
  bearerToken: '<REDACTED:bearer-token>',
  basicAuth: '<REDACTED:basic-auth>',
  apiKeyAssignment: '<REDACTED:key-assignment>',
  jwtHeaderValue: '<REDACTED:jwt>',
  privateKeyBlock: '<REDACTED:private-key>',
  keycloakSecret: '<REDACTED:x-anx-key>',
  urlCredentials: '<REDACTED:url-credentials>',
  credentialObjectName: '<REDACTED:credential-field>',
} as const;

interface SecretPattern {
  name: keyof typeof REDACTIONS;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { name: 'openaiStyleKey', regex: /\bsk-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'anthropicKey', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { name: 'githubToken', regex: /\bgh[pousr]_[A-Za-z0-9]{30,60}\b/g },
  { name: 'googleApiKey', regex: /\bAIza[0-9A-Za-z_-]{30,40}\b/g },
  { name: 'huggingfaceToken', regex: /\bhf_[A-Za-z0-9]{30,60}\b/g },
  { name: 'awsAccessKey', regex: /\b(?:AKIA|ASIA|ABIA|ACCA|ANPA)[0-9A-Z]{14,20}\b/g },
  { name: 'bearerToken', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/gi },
  { name: 'basicAuth', regex: /\bBasic\s+[A-Za-z0-9+/=;]{16,}\b/gi },
  { name: 'apiKeyAssignment', regex: /\b(?:api[_-]?key|secret|token|password|credential|passwd|access[_-]?token)s?\b\s*[:=]\s*['"]?[^\s'"]{8,256}\b/gi },
  { name: 'jwtHeaderValue', regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: 'privateKeyBlock', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { name: 'keycloakSecret', regex: /\bx-anx-[A-Za-z0-9_-]{8,}\b/g },
  { name: 'urlCredentials', regex: /\b(?:https?|ftp):\/\/[^\s/:@]+:[^\s@/]+@[^\s]*\b/g },
];

export interface RedactionOutcome {
  text: string;
  redacted: boolean;
  categories: string[];
}

function applyPatterns(text: string): { text: string; categories: string[] } {
  const categories: string[] = [];
  let out = text;
  for (const { name, regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(out)) {
      categories.push(name);
      out = out.replace(regex, REDACTIONS[name]);
    }
  }
  return { text: out, categories };
}

export const MAX_STRING_LENGTH = 4_000;
export const MAX_ARRAY_LENGTH = 200;
export const MAX_OBJECT_KEYS = 200;

/** Redacts any suspected secrets found in a plain string. */
export function redactSecrets(text: string): RedactionOutcome {
  const { text: scrubbed, categories } = applyPatterns(text);
  const capped =
    scrubbed.length > MAX_STRING_LENGTH ? scrubbed.slice(0, MAX_STRING_LENGTH) + '…[truncated]' : scrubbed;
  return { text: capped, redacted: categories.length > 0, categories };
}

/** Recursively redacts strings in arbitrary untrusted JSON before storage. */
export function scrubUntrustedPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactSecrets(value).text;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map(scrubUntrustedPayload);
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS);
    for (const [k, v] of entries) {
      const keyOutcome = redactSecrets(k);
      // Danger pattern: keys named like credential slots (e.g. "apiKey").
      // Values under such keys are dropped entirely rather than kept.
      if (/^(x-)?(api[_-]?key|secret|password|credential|token|passwd)$/i.test(k.trim())) {
        out[keyOutcome.text] = REDACTIONS.credentialObjectName;
        continue;
      }
      out[keyOutcome.text] = scrubUntrustedPayload(v);
    }
    return out;
  }
  // Functions/symbols/BigInts are never meaningful untrusted JSON; drop them.
  return undefined;
}

/** True if a string still looks like it contains a credential pattern. */
export function looksLikeSecret(text: string): boolean {
  for (const { regex } of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  return false;
}
