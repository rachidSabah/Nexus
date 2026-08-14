# Provider Adapters

This document describes how to add and configure provider adapters in Agent Nexus Gateway.

## Supported Providers

### Cloud providers

| Provider | `providerId` | Auth | Notes |
|---|---|---|---|
| OpenAI | `openai` | Bearer token | Full OpenAI API |
| Anthropic | `anthropic` | `x-api-key` header | Native Messages API translated |
| Google Gemini | `google` | URL `?key=` | Native generateContent translated |
| DeepSeek | `deepseek` | Bearer token | OpenAI-compatible |
| OpenRouter | `openrouter` | Bearer token | OpenAI-compatible aggregator |
| Mistral | `mistral` | Bearer token | OpenAI-compatible |
| xAI (Grok) | `xai` | Bearer token | OpenAI-compatible |
| Groq | `groq` | Bearer token | OpenAI-compatible, ultra-low latency |
| Together | `together` | Bearer token | OpenAI-compatible |
| Fireworks | `fireworks` | Bearer token | OpenAI-compatible |
| Cerebras | `cerebras` | Bearer token | OpenAI-compatible, ultra-fast |
| Cloudflare AI | `cloudflare` | Bearer token | OpenAI-compatible (set baseUrl with account ID) |
| Azure OpenAI | `azure-openai` | `api-key` header | Deployment-based URL scheme |

### Local providers

| Provider | `providerId` | Auth | Default URL |
|---|---|---|---|
| Ollama | `ollama` | none | `http://localhost:11434/v1` |
| vLLM | `vllm` | none | `http://localhost:8000/v1` |
| LM Studio | `lmstudio` | none | `http://localhost:1234/v1` |
| LiteLLM Proxy | `litellm` | Bearer token | `http://localhost:4000/v1` |

## Zero-Config Universal Provider Onboarding (Nexus v0.5.0)

Nexus v0.5.0 introduces the **Universal Provider Fabric**: connect any OpenAI-compatible or cloud provider once through the REST API or Dashboard Provider Center, and Nexus automatically executes the 9-stage onboarding lifecycle:

```
DISCOVER → VALIDATE → AUTHENTICATE → FETCH MODELS → NORMALIZE → REGISTER → INDEX → HEALTH CHECK → READY
```

### Onboarding via REST API

```bash
curl -X POST http://127.0.0.1:8787/v1/providers/onboard \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "groq",
    "displayName": "Groq Cloud",
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "gsk_..."
  }'
```

### Response

```json
{
  "ok": true,
  "status": "READY",
  "providerId": "groq",
  "endpointId": "auto-groq",
  "displayName": "Groq Cloud",
  "baseUrl": "https://api.groq.com/openai/v1",
  "modelsDiscovered": 14,
  "message": "Provider 'Groq Cloud' successfully onboarded with 14 model(s) ready for routing."
}
```

### Testing Connection / Probing without Persisting

```bash
curl -X POST http://127.0.0.1:8787/v1/providers/probe \
  -H "Content-Type: application/json" \
  -d '{
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "gsk_..."
  }'
```

### Via config file

```json
{
  "endpoints": [
    {
      "id": "openai-primary",
      "providerId": "openai",
      "displayName": "OpenAI Primary",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",        // or use OPENAI_API_KEY env var
      "priority": 1,
      "weight": 10,
      "region": "us-east",
      "tags": ["gpt-4", "gpt-4o"],
      "timeoutMs": 30000,
      "maxRetries": 2,
      "concurrencyLimit": 10,
      "pricing": {
        "inputPer1K": 0.01,
        "outputPer1K": 0.03,
        "cachedInputPer1K": 0.005,
        "currency": "USD"
      },
      "capabilities": {
        "streaming": true,
        "toolCalling": true,
        "vision": true,
        "embeddings": true,
        "jsonMode": true,
        "maxOutputTokens": 16384,
        "maxInputTokens": 128000,
        "supportedModalities": ["text", "image"]
      }
    }
  ]
}
```

### Via environment variables (auto-discovery)

If `endpoints` is empty in your config, the gateway auto-registers endpoints from env vars:

| Env var | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `OPENROUTER_API_KEY` | OpenRouter |
| `GOOGLE_API_KEY` or `GEMINI_API_KEY` | Google |
| `GROQ_API_KEY` | Groq |
| `MISTRAL_API_KEY` | Mistral |
| `XAI_API_KEY` | xAI |
| `TOGETHER_API_KEY` | Together |
| `FIREWORKS_API_KEY` | Fireworks |
| `CEREBRAS_API_KEY` | Cerebras |
| `CLOUDFLARE_API_TOKEN` | Cloudflare |

Ollama is always auto-registered (no API key required).

### Via the API (planned)

```bash
curl -X POST http://localhost:8787/v1/providers \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "openai-backup",
    "providerId": "openai",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "priority": 2,
    "weight": 5
  }'
```

## Model Alias Maps

Each adapter can map model aliases to provider-specific model names:

```ts
// Anthropic
'claude-3-5-sonnet' → 'claude-3-5-sonnet-20241022'
'claude-3-5-haiku'  → 'claude-3-5-haiku-20241022'

// Google
'gemini-pro'        → 'gemini-1.5-pro-latest'
'gemini-1.5-flash'  → 'gemini-1.5-flash-latest'
```

You can request either the alias or the full model name. The adapter handles the translation.

## Health Checks

Each adapter implements `healthCheck(endpoint, signal): Promise<boolean>`. The health monitor (planned) will probe each endpoint periodically:

- OpenAI-compatible: `GET /models`
- Anthropic: tiny `messages` call (because Anthropic has no `/models` endpoint)
- Google: `GET /models`
- Local: `GET /models` (or just a TCP connect)

Failed probes emit `health.changed` events.

## Adding a New Provider

### If OpenAI-compatible

Extend `OpenAIAdapter`:

```ts
// packages/providers/src/adapters/openai-compatible.ts
export class MyProviderAdapter extends OpenAIAdapter {
  readonly providerId = 'myprovider';
  readonly displayName = 'My Provider';
  protected apiBase = 'https://api.myprovider.com/v1';
  protected apiKeyEnv = 'MYPROVIDER_API_KEY';

  resolveModel(alias: string): string | undefined {
    const map: Record<string, string> = {
      'my-model': 'my-model-v2',
    };
    return map[alias] ?? alias;
  }
}
```

Register it in `packages/providers/src/index.ts`:

```ts
export class MyProviderAdapter extends OpenAIAdapter { /* ... */ }

// In createDefaultAdapters():
const adapters: ProviderAdapter[] = [
  // ...existing
  new MyProviderAdapter(),
];
```

Add to `SUPPORTED_PROVIDERS`.

### If not OpenAI-compatible

Implement `ProviderAdapter` directly. See `anthropic.ts` for a full example.

Key responsibilities:
1. **`translateRequest`** — convert OpenAI-compatible request to provider's native format
2. **`translateResponse`** — convert provider's response back to OpenAI-compatible
3. **`streamChatCompletion`** — yield `ChatCompletionChunk` objects as they arrive (this is the hardest part — each provider's SSE format is different)
4. **`healthCheck`** — cheap probe that doesn't count against quota

### Tests

Add `packages/providers/test/<provider>.test.ts`. At minimum:

1. Test `translateRequest` produces correct shape
2. Test `translateResponse` parses correctly
3. Test `streamChatCompletion` parses SSE correctly (use a fake stream)
4. Test error handling (401, 429, 500, timeout)

## Authentication Patterns

| Pattern | Example providers | Implementation |
|---|---|---|
| Bearer token | OpenAI, OpenRouter, etc. | `Authorization: Bearer <key>` |
| Custom header | Anthropic (`x-api-key`), Azure (`api-key`) | Override `authHeaderName` and `authHeaderPrefix` |
| URL query param | Google | Append `?key=<key>` to URL |
| OAuth2 | (planned: Bedrock, Vertex) | Token refresh dance |
| AWS Sig V4 | (planned: Bedrock) | boto3-style signing |
| No auth | Ollama, vLLM, LM Studio | Override `getApiKey` to return dummy |

## Pricing

Pricing is per 1K tokens in USD. Used by `least_cost` and `budget_aware` routing strategies.

For providers with tiered pricing (rare), implement a custom `CostCalculatorPort`.

For providers with free tiers (Ollama, vLLM, LM Studio), set pricing to `0`.

## Capabilities

Capabilities drive `capability_match` routing. Be honest — if your provider doesn't support vision, don't claim it does, or users will get errors.

| Capability | Meaning |
|---|---|
| `streaming` | Supports SSE streaming |
| `toolCalling` | Supports function/tool calls |
| `vision` | Supports image input |
| `audio` | Supports audio input |
| `speech` | Supports TTS output |
| `embeddings` | Supports embeddings endpoint |
| `reasoning` | Supports reasoning tokens (e.g. o1) |
| `jsonMode` | Supports `response_format: json_object` |
| `maxOutputTokens` | Hard limit on output |
| `maxInputTokens` | Context window size |
| `supportedModalities` | Array of `text`, `image`, `audio`, `video`, `file` |
