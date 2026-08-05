/**
 * Example: write a simple PII redaction plugin.
 */
import type { Plugin } from '../packages/plugins/src/index.js';

const redactPlugin: Plugin = {
  descriptor: {
    id: 'redact-pii',
    name: 'PII Redactor',
    version: '1.0.0',
    description: 'Redacts email addresses and phone numbers from responses',
    hooks: ['onProviderChunk', 'onResponse'],
    capabilities: ['transform'],
  },

  async onProviderChunk(_ctx, chunk) {
    const c = chunk as { choices?: Array<{ delta?: { content?: string } }> };
    if (c.choices?.[0]?.delta?.content) {
      c.choices[0].delta.content = redact(c.choices[0].delta.content);
    }
    return c;
  },

  async onResponse(_ctx, response) {
    const r = response as { choices?: Array<{ message?: { content?: string } }> };
    if (r.choices?.[0]?.message?.content) {
      r.choices[0].message.content = redact(r.choices[0].message.content);
    }
    return r;
  },
};

function redact(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[REDACTED_EMAIL]')
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED_SSN]');
}

export { redactPlugin, redact };
