# 25 — RAG & Long-Term Memory

[← Previous: Token Efficiency & Compression](24-token-efficiency-and-prompt-compression.md) | [Index](01-introduction-and-overview.md) | [Next: Tool Runtime & MCP Integration →](26-tool-runtime-and-mcp-integration.md)

---

## File-Backed Vector Store & RAG Pipeline

Nexus provides persistent, restart-surviving long-term memory via `FileVectorStore` and `RagPipeline` (`packages/memory/`):

- **Embeddings Ingestion**: Generates high-dimensional vector representations using gateway-registered embedding models.
- **Persistent Storage**: Serialized to `~/.agent-nexus/memory.json` and `~/.agent-nexus/rag.json`.
- **Exact & Cosine Similarity Retrieval**: Fallback to exact keyword matching if no embedding provider is registered.

---

## RAG Endpoints

### Ingest Document
```http
POST /v1/rag/ingest
Content-Type: application/json

{
  "documentId": "doc-arch-specs",
  "text": "Nexus uses hexagonal architecture with clean ports...",
  "metadata": { "category": "engineering", "version": "0.5.0" }
}
```

### Semantic Retrieve
```http
POST /v1/rag/retrieve
Content-Type: application/json

{
  "query": "How does Nexus implement hexagonal architecture?",
  "topK": 3
}
```

---

[← Previous: Token Efficiency & Compression](24-token-efficiency-and-prompt-compression.md) | [Index](01-introduction-and-overview.md) | [Next: Tool Runtime & MCP Integration →](26-tool-runtime-and-mcp-integration.md)
