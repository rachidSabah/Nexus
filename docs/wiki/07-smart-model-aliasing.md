# 07 — Smart Model Aliasing

[← Previous: Autonomous Intelligent Routing](06-autonomous-intelligent-routing.md) | [Index](01-introduction-and-overview.md) | [Next: Key Rotation & Cooldown →](08-key-rotation-and-cooldown.md)

---

## Virtual Model Aliases

Nexus allows client applications, IDEs, and coding agents to target **virtual aliases** rather than hardcoded vendor model strings.

### Built-in System Aliases

| Virtual Alias | Dynamic Target Profile | Fallback Priority |
|---|---|---|
| `nexus/best-coding` | Highest quality coding model (Claude 3.7 Sonnet / GPT-4o / DeepSeek Coder) | Claude 3.7 → GPT-4o → DeepSeek-V3 → Qwen 2.5 Coder |
| `nexus/fast` | Ultra-low latency model (< 500ms TTFT, Groq / Cerebras / Llama 3 8B) | Groq Llama 3 → Cerebras Llama 3.1 → Claude 3.5 Haiku |
| `nexus/free` | Strictly zero-cost model (Local Ollama / OpenRouter free tier) | Ollama Qwen 2.5 → Ollama Llama 3 → OpenRouter Free |
| `nexus/best` | Highest general benchmark model (o3-mini / Claude 3.7 / GPT-4o) | o3-mini → Claude 3.7 → GPT-4o |
| `nexus/cheap` | Lowest $/token model with high quality | DeepSeek-V3 → Gemini 2.0 Flash → Claude 3.5 Haiku |

---

## Custom Alias Registration API

Register custom team or project aliases dynamically:

```http
POST /v1/aliases
Content-Type: application/json

{
  "alias": "team/frontend-builder",
  "description": "Optimized for React/TypeScript and Tailwind development",
  "filter": {
    "capability": "toolCalling",
    "minContextWindow": 128000
  },
  "ranking": "quality"
}
```

### Test-Resolve Alias

```http
GET /v1/aliases/nexus/best-coding/resolve
```

Response:
```json
{
  "alias": "nexus/best-coding",
  "resolvedModel": "claude-3-7-sonnet",
  "providerId": "anthropic",
  "reason": "Top scoring candidate for CODING intent"
}
```

---

[← Previous: Autonomous Intelligent Routing](06-autonomous-intelligent-routing.md) | [Index](01-introduction-and-overview.md) | [Next: Key Rotation & Cooldown →](08-key-rotation-and-cooldown.md)
