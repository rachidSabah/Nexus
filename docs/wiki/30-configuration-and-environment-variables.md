# 30 — Configuration & Environment Variables

[← Previous: CLI Reference & Automation](29-cli-reference-and-automation.md) | [Index](01-introduction-and-overview.md) | [Next: Troubleshooting & Runbooks →](31-troubleshooting-and-runbooks.md)

---

## Environment Variables Reference

| Environment Variable | Default Value | Description |
|---|---|---|
| `AGENT_NEXUS_PORT` | `8787` | HTTP/SSE server listening port |
| `AGENT_NEXUS_HOST` | `127.0.0.1` | Network interface binding host |
| `AGENT_NEXUS_VAULT_KEY` | *(ephemeral in-memory)* | AES-256 master key for encrypted vault (set for prod) |
| `NEXUS_DB_PATH` | `~/.agent-nexus/nexus.db` | SQLite database file location |
| `ANX_VAULT_PATH` | `~/.agent-nexus/vault.json` | Encrypted credential vault path |
| `ANX_MEMORY_PATH` | `~/.agent-nexus/memory.json` | Long-term vector memory file |
| `ANX_RAG_PATH` | `~/.agent-nexus/rag.json` | RAG document storage file |
| `NEXUS_AUDIT_ENABLED` | `true` | Enables security and access audit logging |
| `NEXUS_REPO_ROOT` | `process.cwd()` | Workspace isolation repository boundary |

---

[← Previous: CLI Reference & Automation](29-cli-reference-and-automation.md) | [Index](01-introduction-and-overview.md) | [Next: Troubleshooting & Runbooks →](31-troubleshooting-and-runbooks.md)
