# 24 — Token Efficiency & Prompt Compression

[← Previous: Security, RBAC & Isolation](23-security-rbac-and-isolation.md) | [Index](01-introduction-and-overview.md) | [Next: RAG & Long-Term Memory →](25-rag-and-long-term-memory.md)

---

## Token Optimization Pipeline

Nexus includes the **Token Efficiency Engine** (`@anx/token-efficiency`) designed to cut API costs by 30–60%:

1. **Exact-Match & Semantic Caching**: Identical or semantically equivalent prompts return instant cached responses with 0 upstream tokens spent.
2. **Context Window Compression**: Redundant whitespace, verbose system instructions, and duplicated conversation history are trimmed via `PromptCompressor`.
3. **Proactive Budget Guard**: Hard limits and soft alerts per tenant / project via `BudgetManager`.

```http
GET /v1/debug/tokens
```

Response:
```json
{
  "stats": {
    "totalRequests": 4500,
    "totalOriginalTokens": 3200000,
    "totalOptimizedTokens": 1800000,
    "totalSavedTokens": 1400000,
    "overallSavingsPct": 43.8
  }
}
```

---

[← Previous: Security, RBAC & Isolation](23-security-rbac-and-isolation.md) | [Index](01-introduction-and-overview.md) | [Next: RAG & Long-Term Memory →](25-rag-and-long-term-memory.md)
