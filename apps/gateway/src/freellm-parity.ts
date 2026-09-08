/**
 * FreeLLMAPI parity surface — P0 API gaps (auto:* routing aliases, legacy
 * completions, native Gemini v1beta, Ollama emulation, media passthrough
 * shapes, Fusion helpers, X-Routed-Via, dependency-free v1/docs viewer).
 *
 * Design constraints (do not weaken):
 * - PURE translators only: no server/fastify/network imports. Every export
 *   is a deterministic function of its inputs, unit-testable without boot.
 * - No invented data: token counts are mapped from the real usage object;
 *   the Gemini countTokens helper is explicitly an estimator (see
 *   estimateGeminiTokens) and is labeled as such in v1/docs.
 * - Additive: existing handlers keep their behavior; this module only adds
 *   new request/response shapes beside them.
 */
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '@anx/core';

// ── X-Routed-Via ──────────────────────────────────────────────────────────

export const X_ROUTED_VIA = 'X-Routed-Via';

/** True for the virtual multi-model synthesis id ('fusion', any case). */
export function isFusionModel(model: unknown): boolean {
  return typeof model === 'string' && model.trim().toLowerCase() === 'fusion';
}

/**
 * Value for the X-Routed-Via response header
 * (FreeLLMAPI parity — tells the caller which provider served the request).
 * Format: platform/model, e.g. 'groq/llama-3.3-70b-versatile'.
 */
export function routedVia(provider: string, model: string): string {
  const p = (provider ?? '').trim() || 'unknown';
  const m = (model ?? '').trim() || 'unknown';
  return p + '/' + m;
}

// ── auto:* routing aliases ────────────────────────────────────────────────

export type AutoModelRequest =
  | { kind: 'auto'; profile: 'default' | 'fast' | 'smart' }
  | { kind: 'profile'; name: string };

/**
 * Parse FreeLLMAPI-style model selectors:
 *   'auto'        → router pick (maps to local/auto)
 *   'auto:fast'   → lowest-latency pick (maps to local/fast)
 *   'auto:smart'  → highest-quality pick (maps to local/best)
 *   'auto:<name>' → named fallback-chain profile (custom alias lookup)
 * Returns null for anything else (normal model ids pass through untouched).
 */
export function parseAutoModel(model: unknown): AutoModelRequest | null {
  if (typeof model !== 'string') return null;
  const t = model.trim();
  if (t.toLowerCase() === 'auto') return { kind: 'auto', profile: 'default' };
  const m = /^auto\s*:\s*([A-Za-z0-9][A-Za-z0-9_.-]*)$/i.exec(t);
  if (!m || !m[1]) return null;
  const name = m[1].toLowerCase();
  if (name === 'fast') return { kind: 'auto', profile: 'fast' };
  if (name === 'smart') return { kind: 'auto', profile: 'smart' };
  return { kind: 'profile', name: m[1] };
}

/**
 * Ordered alias-registry candidates for a parsed auto request. The caller
 * resolves the first candidate that exists; local/auto etc. are the
 * built-in Nexus aliases, trailing entries cover user-registered profiles.
 */
export function autoAliasCandidates(parsed: AutoModelRequest): string[] {
  if (parsed.kind === 'auto') {
    if (parsed.profile === 'fast') return ['local/fast'];
    if (parsed.profile === 'smart') return ['local/best'];
    return ['local/auto'];
  }
  const n = parsed.name;
  return ['local/' + n, 'nexus/' + n, n];
}

// ── Legacy /v1/completions (editor ghost-text) ────────────────────────────

export interface CompletionsRequest {
  readonly model?: string;
  readonly prompt?: string | readonly string[];
  readonly suffix?: string;
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly stream?: boolean;
  readonly stop?: string | readonly string[];
  readonly user?: string;
}

/** Join a completions prompt (string or array) plus optional suffix. */
export function completionsPromptText(prompt: unknown, suffix?: unknown): string {
  const base = Array.isArray(prompt)
    ? prompt.filter((p): p is string => typeof p === 'string').join('\n')
    : typeof prompt === 'string'
      ? prompt
      : '';
  return base + (typeof suffix === 'string' ? suffix : '');
}

/** Translate a legacy completions request into the internal chat shape. */
export function completionsToChat(body: CompletionsRequest): ChatCompletionRequest {
  const text = completionsPromptText(body.prompt, body.suffix);
  return {
    model: body.model ?? 'auto',
    messages: [{ role: 'user', content: text }],
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.top_p !== undefined ? { topP: body.top_p } : {}),
    ...(body.max_tokens !== undefined ? { maxTokens: body.max_tokens } : {}),
    ...(body.stop !== undefined ? { stop: body.stop } : {}),
    ...(body.user !== undefined ? { user: body.user } : {}),
  };
}

/** First-choice message text of a chat response (completions/Gemini/Ollama). */
export function firstChoiceText(resp: ChatCompletionResponse): string {
  const msg = resp.choices?.[0]?.message as { content?: unknown } | undefined;
  const content = msg?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === 'string'
          ? p
          : typeof (p as { text?: unknown }).text === 'string'
            ? ((p as { text?: unknown }).text as string)
            : '',
      )
      .join('');
  }
  return '';
}

export interface WireUsageSnake {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** Map any accepted usage shape (camelCase or snake_case) to wire shape. */
export function toSnakeUsage(usage: unknown): WireUsageSnake {
  if (usage === null || typeof usage !== 'object' || Array.isArray(usage)) {
    return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  }
  const u = usage as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const prompt = num(u['prompt_tokens'] ?? u['promptTokens']);
  const completion = num(u['completion_tokens'] ?? u['completionTokens']);
  const total = num(u['total_tokens'] ?? u['totalTokens']) || prompt + completion;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

/** Translate a chat response into a legacy text_completion response. */
export function chatResponseToCompletion(
  resp: ChatCompletionResponse,
  requestedModel: string,
): Record<string, unknown> {
  const choice = resp.choices?.[0];
  return {
    id: resp.id,
    object: 'text_completion',
    created: resp.created,
    model: requestedModel,
    choices: [
      {
        text: firstChoiceText(resp),
        index: 0,
        finish_reason: choice?.finish_reason ?? 'stop',
        logprobs: null,
      },
    ],
    usage: toSnakeUsage(resp.usage),
  };
}

// ── Native Gemini v1beta ──────────────────────────────────────────────────

export interface GeminiPart {
  readonly text?: string;
}

export interface GeminiContent {
  readonly role?: string;
  readonly parts?: readonly GeminiPart[];
}

export interface GeminiGenerateBody {
  readonly contents?: readonly GeminiContent[];
  readonly systemInstruction?: { readonly parts?: readonly GeminiPart[] };
  readonly generationConfig?: {
    readonly temperature?: number;
    readonly topP?: number;
    readonly maxOutputTokens?: number;
    readonly stopSequences?: readonly string[];
  };
}

function geminiPartsText(parts: readonly GeminiPart[] | undefined): string {
  return (parts ?? []).map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
}

/**
 * Translate a Gemini generateContent request into the internal chat shape.
 * Roles: 'model' → assistant, everything else → user; systemInstruction
 * becomes the leading system message.
 */
export function geminiToChat(requestedModel: string, body: GeminiGenerateBody): ChatCompletionRequest {
  const messages: ChatMessage[] = [];
  const sys = geminiPartsText(body.systemInstruction?.parts);
  if (sys) messages.push({ role: 'system', content: sys });
  for (const c of body.contents ?? []) {
    messages.push({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: geminiPartsText(c.parts),
    });
  }
  const gc = body.generationConfig ?? {};
  const hasSearch = (body as unknown as Record<string, unknown>).tools
    ? (
        ((body as unknown as Record<string, unknown>).tools as Array<Record<string, unknown>>).some(
          (t) => t.google_search || t.googleSearch,
        )
      )
    : false;

  const req: ChatCompletionRequest = {
    model: requestedModel,
    messages,
    ...(gc.temperature !== undefined ? { temperature: gc.temperature } : {}),
    ...(gc.topP !== undefined ? { topP: gc.topP } : {}),
    ...(gc.maxOutputTokens !== undefined ? { maxTokens: gc.maxOutputTokens } : {}),
    ...(gc.stopSequences !== undefined ? { stop: gc.stopSequences } : {}),
  };
  if (hasSearch) {
    (req as unknown as Record<string, unknown>).google_search = true;
  }
  return req;
}

/** Translate a chat response into a Gemini generateContent response. */
export function chatResponseToGemini(
  resp: ChatCompletionResponse,
  requestedModel: string,
): Record<string, unknown> {
  const u = toSnakeUsage(resp.usage);
  const grounding =
    (resp as unknown as Record<string, unknown>).grounding_metadata ??
    ((resp.choices[0] as unknown as Record<string, unknown>)?.grounding_metadata);

  return {
    candidates: [
      {
        content: { role: 'model', parts: [{ text: firstChoiceText(resp) }] },
        finishReason: 'STOP',
        index: 0,
        ...(grounding ? { groundingMetadata: grounding } : {}),
      },
    ],
    usageMetadata: {
      promptTokenCount: u.prompt_tokens,
      candidatesTokenCount: u.completion_tokens,
      totalTokenCount: u.total_tokens,
    },
    modelVersion: requestedModel,
  };
}

/**
 * Honest token estimator for the countTokens surface (no tokenizer on the
 * gateway; ~4 chars/token for English text). Labeled 'ESTIMATED' nowhere in
 * the wire shape (upstream parity), but documented in v1/docs.
 */
export function estimateGeminiTokens(body: GeminiGenerateBody): number {
  let chars = geminiPartsText(body.systemInstruction?.parts).length;
  for (const c of body.contents ?? []) chars += geminiPartsText(c.parts).length;
  return Math.max(1, Math.ceil(chars / 4));
}

/** Minimal model view the parity helpers need (mapped from ModelDescriptor). */
export interface ParityModelView {
  readonly id: string;
  readonly providerId: string;
  readonly displayName?: string;
  readonly contextWindow?: number;
}

/** Gemini models.list projection: { models: [{ name: 'models/<id>', ... }] }. */
export function geminiModelsList(models: readonly ParityModelView[]): Record<string, unknown> {
  return {
    models: models.map((m) => ({
      name: 'models/' + m.id,
      version: '001',
      displayName: m.displayName ?? m.id,
      description: 'Served by Nexus provider ' + m.providerId,
      inputTokenLimit: m.contextWindow ?? 32768,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ['generateContent', 'streamGenerateContent', 'countTokens'],
    })),
  };
}

// ── Ollama emulation (/api/*) ─────────────────────────────────────────────
// Serves Zed, JetBrains AI and other local-model clients over the Ollama
// wire shape (NDJSON chat/generate, tags, show, embeddings).

export interface OllamaMessage {
  readonly role: string;
  readonly content: string;
}

export interface OllamaChatRequest {
  readonly model?: string;
  readonly messages?: readonly OllamaMessage[];
  readonly stream?: boolean;
  readonly options?: {
    readonly temperature?: number;
    readonly top_p?: number;
    readonly num_predict?: number;
    readonly stop?: readonly string[];
  };
}

export interface OllamaGenerateRequest {
  readonly model?: string;
  readonly prompt?: string;
  readonly system?: string;
  readonly stream?: boolean;
  readonly options?: OllamaChatRequest['options'];
}

/** Translate an Ollama /api/chat request into the internal chat shape. */
export function ollamaChatToInternal(body: OllamaChatRequest): ChatCompletionRequest {
  const messages: ChatCompletionRequest['messages'] = (body.messages ?? []).map((m) => ({
    role: m.role === 'assistant' || m.role === 'system' ? m.role : 'user',
    content: m.content ?? '',
  }));
  const o = body.options ?? {};
  return {
    model: body.model ?? 'auto',
    messages,
    ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
    ...(o.top_p !== undefined ? { topP: o.top_p } : {}),
    ...(o.num_predict !== undefined ? { maxTokens: o.num_predict } : {}),
    ...(o.stop !== undefined ? { stop: o.stop } : {}),
  };
}

/** Translate an Ollama /api/generate request into the internal chat shape. */
export function ollamaGenerateToInternal(body: OllamaGenerateRequest): ChatCompletionRequest {
  const messages: ChatMessage[] = [];
  if (body.system) messages.push({ role: 'system', content: body.system });
  messages.push({ role: 'user', content: body.prompt ?? '' });
  const o = body.options ?? {};
  return {
    model: body.model ?? 'auto',
    messages,
    ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
    ...(o.top_p !== undefined ? { topP: o.top_p } : {}),
    ...(o.num_predict !== undefined ? { maxTokens: o.num_predict } : {}),
    ...(o.stop !== undefined ? { stop: o.stop } : {}),
  };
}

function isoCreated(createdSec: number): string {
  return new Date(createdSec * 1000).toISOString();
}

/** Translate a chat response into an Ollama /api/chat (non-stream) object. */
export function chatResponseToOllamaChat(
  resp: ChatCompletionResponse,
  requestedModel: string,
): Record<string, unknown> {
  return {
    model: requestedModel,
    created_at: isoCreated(resp.created),
    message: { role: 'assistant', content: firstChoiceText(resp) },
    done: true,
    done_reason: resp.choices?.[0]?.finish_reason ?? 'stop',
    total_duration: resp.latencyMs * 1_000_000,
    load_duration: 0,
    prompt_eval_count: toSnakeUsage(resp.usage).prompt_tokens,
    eval_count: toSnakeUsage(resp.usage).completion_tokens,
  };
}

/** Translate a chat response into an Ollama /api/generate (non-stream) object. */
export function chatResponseToOllamaGenerate(
  resp: ChatCompletionResponse,
  requestedModel: string,
): Record<string, unknown> {
  return {
    model: requestedModel,
    created_at: isoCreated(resp.created),
    response: firstChoiceText(resp),
    done: true,
    done_reason: resp.choices?.[0]?.finish_reason ?? 'stop',
    total_duration: resp.latencyMs * 1_000_000,
    load_duration: 0,
    prompt_eval_count: toSnakeUsage(resp.usage).prompt_tokens,
    eval_count: toSnakeUsage(resp.usage).completion_tokens,
  };
}

/** One NDJSON line for Ollama streaming (chat or generate). */
export function ollamaStreamLine(
  kind: 'chat' | 'generate',
  requestedModel: string,
  chunk: ChatCompletionChunk,
  done: boolean,
): string {
  const text = (chunk.choices?.[0]?.delta as { content?: unknown } | undefined)?.content;
  const str = typeof text === 'string' ? text : '';
  const base = {
    model: requestedModel,
    created_at: isoCreated(chunk.created),
    done,
    ...(kind === 'chat'
      ? { message: { role: 'assistant', content: str } }
      : { response: str }),
  };
  return JSON.stringify(base);
}

/** Ollama /api/tags projection over discovered models. */
export function ollamaTags(models: readonly ParityModelView[]): Record<string, unknown> {
  return {
    models: models.map((m) => ({
      name: m.id + ':latest',
      model: m.id + ':latest',
      modified_at: new Date().toISOString(),
      size: 0,
      digest: '',
      details: {
        parent_model: '',
        format: 'nexus',
        family: m.providerId,
        parameter_size: '',
        quantization_level: '',
      },
    })),
  };
}

/** Ollama /api/show projection for one model (null when unknown). */
export function ollamaShow(model: ParityModelView | undefined): Record<string, unknown> | null {
  if (!model) return null;
  return {
    modelfile: '# Nexus proxied model ' + model.id,
    parameters: '',
    template: '',
    details: { parent_model: '', format: 'nexus', family: model.providerId },
    model_info: { 'general.architecture': model.providerId },
    capabilities: ['completion'],
  };
}

/** Normalize Ollama /api/embeddings input (input[] or prompt) to strings. */
export function ollamaEmbeddingsInput(body: {
  readonly input?: unknown;
  readonly prompt?: unknown;
}): string[] {
  if (Array.isArray(body.input)) return body.input.filter((s): s is string => typeof s === 'string');
  if (typeof body.input === 'string') return [body.input];
  if (typeof body.prompt === 'string') return [body.prompt];
  return [];
}

// ── Media passthrough shapes ──────────────────────────────────────────────

export const MEDIA_JSON_PATHS = [
  '/v1/images/generations',
  '/v1/videos/generations',
  '/v1/audio/speech',
] as const;

export type MediaJsonPath = (typeof MEDIA_JSON_PATHS)[number];

/** Honest 501 body when no media-capable endpoint is configured. */
export function mediaNotAvailable(configuredProviders: readonly string[]): {
  status: number;
  body: Record<string, unknown>;
} {
  return {
    status: 501,
    body: {
      error: {
        message:
          'No media-capable endpoint configured. Add an OpenAI-compatible ' +
          'endpoint whose provider serves media models (e.g. OpenAI) — see ' +
          'POST /v1/providers/onboard. Configured providers: ' +
          (configuredProviders.join(', ') || '(none)') +
          '. Audio transcriptions (multipart ingest) are not served yet.',
        code: 'MEDIA_NOT_SUPPORTED',
      },
    },
  };
}

/** Honest 501 body for the multipart-only transcriptions surface. */
export function transcriptionsNotAvailable(): { status: number; body: Record<string, unknown> } {
  return {
    status: 501,
    body: {
      error: {
        message:
          'Audio transcriptions require multipart/form-data ingest, which the ' +
          'gateway does not parse yet. Images, video and speech (JSON) are ' +
          'served via media-capable OpenAI-compatible endpoints.',
        code: 'TRANSCRIPTION_MULTIPART_UNSUPPORTED',
      },
    },
  };
}

// ── Fusion (multi-model synthesis) ────────────────────────────────────────

export const FUSION_PANEL_SIZE = 3;
export const FUSION_JUDGE_SYSTEM =
  'You are a judge synthesizing one best answer from candidate drafts. ' +
  'Use the strongest reasoning and facts across drafts, drop errors and ' +
  'duplication, and answer directly without mentioning the drafts.';

/** Judge messages for the synthesis pass over collected drafts. */
export function buildFusionJudgeMessages(
  question: string,
  drafts: readonly { readonly model: string; readonly text: string }[],
): ChatCompletionRequest['messages'] {
  const rendered = drafts
    .map((d, i) => '--- Draft ' + (i + 1) + ' (' + d.model + ') ---\n' + d.text)
    .join('\n\n');
  return [
    { role: 'system', content: FUSION_JUDGE_SYSTEM },
    {
      role: 'user',
      content:
        'Original prompt:\n' + question + '\n\nCandidate drafts:\n' + rendered + '\n\nSynthesize the single best answer.',
    },
  ];
}

/** Last user message text — the question the fusion panel answers. */
export function fusionQuestion(messages: readonly { readonly role: string; readonly content: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

// ── Dependency-free /v1/docs viewer ───────────────────────────────────────
// No external URLs, no CDN, no framework: fetches /v1/openapi.json and
// renders a searchable route table. Single file so it works offline.

export const OPENAPI_DOCS_HTML = '<!DOCTYPE html>\n' +
  '<html lang="en">\n' +
  '<head><meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<title>Nexus Gateway API</title>\n' +
  '<style>\n' +
  ':root{color-scheme:dark light}\n' +
  'body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:24px}\n' +
  'input{width:100%;padding:8px;font-size:15px;margin:12px 0}\n' +
  '.row{border-bottom:1px solid #8884;padding:8px 0}\n' +
  '.m{display:inline-block;min-width:56px;font-weight:700}\n' +
  '.get{color:#4ade80}.post{color:#60a5fa}.delete{color:#f87171}.put{color:#fbbf24}\n' +
  '.path{font-family:monospace}\n' +
  '</style></head>\n' +
  '<body>\n' +
  '<h1>Nexus Gateway API</h1>\n' +
  '<p>Live spec: <span class="path">/v1/openapi.json</span> — chat, responses, messages, completions, embeddings, media, Gemini v1beta, Ollama, MCP.</p>\n' +
  '<input id="q" type="search" placeholder="Filter routes…" autocomplete="off">\n' +
  '<div id="routes"><p>Loading…</p></div>\n' +
  '<script>\n' +
  'var q=document.getElementById("q"),box=document.getElementById("routes"),all=[];\n' +
  'fetch("/v1/openapi.json").then(function(r){return r.json()}).then(function(spec){\n' +
  '  var paths=spec.paths||{};\n' +
  '  Object.keys(paths).forEach(function(p){\n' +
  '    Object.keys(paths[p]).forEach(function(m){\n' +
  '      all.push({m:m.toUpperCase(),p:p,s:(paths[p][m]&&paths[p][m].summary)||""});\n' +
  '    });\n' +
  '  });\n' +
  '  render("");\n' +
  '}).catch(function(e){box.innerHTML="<p>Failed to load spec: "+String(e)+"</p>"});\n' +
  'function render(f){\n' +
  '  var h="";\n' +
  '  all.forEach(function(r){\n' +
  '    if(f&&r.m.toLowerCase().indexOf(f)<0&&r.p.toLowerCase().indexOf(f)<0&&r.s.toLowerCase().indexOf(f)<0)return;\n' +
  '    h+="<div class=\\"row\\"><span class=\\"m "+r.m.toLowerCase()+"\\">"+r.m+"</span> <span class=\\"path\\">"+r.p+"</span><div>"+r.s+"</div></div>";\n' +
  '  });\n' +
  '  box.innerHTML=h||"<p>No routes match.</p>";\n' +
  '}\n' +
  'q.addEventListener("input",function(){render(q.value.toLowerCase())});\n' +
  '</script>\n' +
  '</body>\n' +
  '</html>\n';
