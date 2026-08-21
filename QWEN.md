# Qwen via Nexus — Tips & Reference

Nexus exposes Alibaba **Qwen** models through its **OpenRouter** integration (no
separate Qwen API key required — OpenRouter's key is enough). Because Qwen is
not a standalone provider in this build, Qwen models appear under the
`openrouter` provider namespace as `qwen/<model>`.

## How to find Qwen models

- **Dashboard → Models page:** filter by provider `openrouter`, then search
  `qwen`. There are ~51 Qwen models available (qwen3.5 → qwen3.8 families,
  instruct / coder / plus / max / flash variants).
- **CLI / API:** list them directly:

  ```bash
  curl -s -H "Authorization: Bearer nexus" \
    "http://127.0.0.1:8787/v1/models?providerId=openrouter&limit=2000" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=(JSON.parse(s).data||[]).filter(x=>/^qwen\//.test(x.id));a.forEach(m=>console.log(m.id))})"
  ```

## Using Qwen from a coding agent

The Models page shows a ready-to-copy snippet for any selected model:

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="nexus"
# then point your agent at the model id, e.g.
qwen --model nexus/openrouter/qwen/qwen3.8-27b
```

For any OpenAI-compatible agent (Codex, Aider, Hermes, Continue, etc.):

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8787/v1"
export OPENAI_API_KEY="nexus"
# model id is the full Nexus id:
#   openrouter/qwen/qwen3.8-27b
```

## Recommended Qwen picks

| Use case            | Model id (Nexus)                    | Notes                                    |
| ------------------- | ----------------------------------- | ---------------------------------------- |
| General / balanced  | `openrouter/qwen/qwen3.8-max`       | Flagship, strongest reasoning            |
| Coding              | `openrouter/qwen/qwen3-coder`       | Code-gen & agentic tasks                 |
| Cheap / fast        | `openrouter/qwen/qwen3.7-flash`     | Low-latency, low cost                    |
| Local-class         | `openrouter/qwen/qwen3.6-27b`       | Mid-size, good price/perf               |
| Plus tier           | `openrouter/qwen/qwen3.7-plus`      | Good all-rounder                         |

## Notes

- **Qwen is served via OpenRouter**, so it inherits OpenRouter's upstream
  limits (account credits / data-policy settings). If a request fails with a
  `4xx` from OpenRouter, check your OpenRouter account's privacy/guardrail
  settings at `https://openrouter.ai/settings/privacy`.
- There is intentionally **no `qwen` provider adapter** in this build — Qwen is
  reached exclusively through OpenRouter. Adding a native `QwenAdapter`
  (DashScope `https://dashscope.aliyuncs.com/compatible-mode/v1`) is a future
  option if a dedicated key is supplied.
- Qwen models are **free-tier eligible** when selected from OpenRouter's free
  listings; the dashboard's Free filter surfaces those automatically.
