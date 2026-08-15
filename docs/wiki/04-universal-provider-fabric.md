# 04 — Universal Provider Fabric

[← Previous: Quickstart & Installation](03-quickstart-and-installation.md) | [Index](01-introduction-and-overview.md) | [Next: Dynamic Model Discovery →](05-dynamic-model-discovery.md)

---

## Universal Provider Support

Nexus integrates with any OpenAI-compatible, Anthropic-compatible, or proprietary AI inference backend through its **Universal Provider Fabric**.

### Supported Providers Out of the Box

| Provider | ID | Default Base URL | Protocols | Special Features |
|---|---|---|---|---|
| **OpenAI** | `openai` | `https://api.openai.com/v1` | OpenAI REST | GPT-4o, o1, o3-mini, Embeddings, JSON Mode |
| **Anthropic** | `anthropic` | `https://api.anthropic.com/v1` | Anthropic Messages | Claude 3.7 Sonnet, Thinking/Reasoning Mode |
| **Google Gemini** | `gemini` | `https://generativelanguage.googleapis.com/v1beta` | Gemini REST | 1M-2M context window, Multimodal |
| **Ollama** | `ollama` | `http://localhost:11434/v1` | OpenAI REST | Local zero-cost inference, Llama 3, Qwen 2.5 |
| **OpenRouter** | `openrouter` | `https://openrouter.ai/api/v1` | OpenAI REST | 200+ models, multi-vendor fallback |
| **Groq** | `groq` | `https://api.groq.com/openai/v1` | OpenAI REST | Ultra-low latency LPU inference |
| **Mistral AI** | `mistral` | `https://api.mistral.ai/v1` | OpenAI REST | Mistral Large, Codestral |
| **DeepSeek** | `deepseek` | `https://api.deepseek.com/v1` | OpenAI REST | DeepSeek-V3, DeepSeek-R1 (Thinking mode) |
| **Cerebras** | `cerebras` | `https://api.cerebras.ai/v1` | OpenAI REST | Wafer-scale engine, 2000+ tok/s |
| **Together AI** | `together` | `https://api.together.xyz/v1` | OpenAI REST | Open source fine-tunes & serverless endpoints |
| **Custom / Private**| `custom` | Custom user URL | OpenAI REST | vLLM, TGI, LocalAI, LM Studio, Private VPCs |

---

## Zero-Config Provider Onboarding API

Onboard any new AI provider dynamically at runtime without restarting the server:

```http
POST /v1/providers/onboard
Content-Type: application/json

{
  "providerId": "vllm-local",
  "displayName": "Local vLLM Cluster",
  "baseUrl": "http://192.168.1.100:8000/v1",
  "apiKey": "optional-cluster-token",
  "priority": 10,
  "weight": 1
}
```

Response:
```json
{
  "ok": true,
  "status": "READY",
  "providerId": "vllm-local",
  "endpointId": "auto-vllm-local",
  "displayName": "Local vLLM Cluster",
  "baseUrl": "http://192.168.1.100:8000/v1",
  "modelsDiscovered": 3,
  "message": "Provider 'Local vLLM Cluster' successfully onboarded with 3 model(s) ready for routing."
}
```

---

## SSRF Security & Safety Guardrails

All provider base URLs are strictly validated using `isSsrfSafe()` in `packages/core/src/security/ssrf.ts`.
- Blocks AWS/GCP/Azure cloud metadata IPs (`169.254.169.254`, `metadata.google.internal`).
- Enforces HTTP/HTTPS protocol restrictions.
- Prevents DNS rebinding and internal network scanning.

---

[← Previous: Quickstart & Installation](03-quickstart-and-installation.md) | [Index](01-introduction-and-overview.md) | [Next: Dynamic Model Discovery →](05-dynamic-model-discovery.md)
