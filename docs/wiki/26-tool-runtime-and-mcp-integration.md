# 26 — Tool Runtime & MCP Integration

[← Previous: RAG & Long-Term Memory](25-rag-and-long-term-memory.md) | [Index](01-introduction-and-overview.md) | [Next: Agent Teams & Collaboration →](27-agent-teams-and-collaboration.md)

---

## Model Context Protocol (MCP) Support

Nexus natively implements both **MCP Client** (`@anx/mcp-client`) and **MCP Server** (`@anx/mcp-server`) interfaces:

1. **MCP Server**: Exposes Nexus tools and routing over JSON-RPC (`POST /v1/mcp`).
2. **MCP Client**: Connects Nexus agents to external MCP tool servers (filesystem, GitHub, databases, web scrapers).

---

## Tool Execution API

```http
POST /v1/tools/run_command/execute
Content-Type: application/json

{
  "input": {
    "command": "git status"
  },
  "agentId": "claude-code",
  "taskId": "task-check-git"
}
```

---

[← Previous: RAG & Long-Term Memory](25-rag-and-long-term-memory.md) | [Index](01-introduction-and-overview.md) | [Next: Agent Teams & Collaboration →](27-agent-teams-and-collaboration.md)
