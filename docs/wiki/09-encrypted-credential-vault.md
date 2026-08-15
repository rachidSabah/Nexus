# 09 — Encrypted Credential Vault

[← Previous: Key Rotation & Cooldown](08-key-rotation-and-cooldown.md) | [Index](01-introduction-and-overview.md) | [Next: Universal Local Agent Bridge →](10-universal-local-agent-bridge.md)

---

## Zero-Leak Cryptographic Architecture

Nexus enforces a strict **Zero-Leak Security Boundary**:

1. **Encrypted Storage**: Secrets (API keys, tokens, proxy credentials) are encrypted using **AES-256-GCM** with unique initialization vectors (IVs) and authenticated tags.
2. **Master Key**: Driven by the environment variable `AGENT_NEXUS_VAULT_KEY`.
3. **Database Isolation**: The SQLite database only stores sanitized key metadata (`lastFour`, `status`, `registeredAt`). Plaintext secrets **never** touch the database.
4. **Log Redaction**: All logging and telemetry buffers filter out credential patterns via `redactSecrets()`.

```mermaid
graph TD
    Client["Client / CLI"] -->|POST sk-ant-api03-...| GW["Nexus Ingress"]
    GW --> Vault["Encrypted Credential Vault (AES-256-GCM)"]
    Vault -->|Encrypted Blob| Disk["vault.json (Encrypted File)"]
    Vault -->|Sanitized Metadata (lastFour: 1234)| DB["SQLite Database (Metadata Only)"]
    Vault -->|Plaintext in Memory Only| Adapter["Outbound HTTP Provider Adapter"]
```

---

## Vault File Configuration

Set the vault location and master key in your environment:

```bash
# Production Master Vault Key (Must be 32+ characters or high-entropy string)
export AGENT_NEXUS_VAULT_KEY="your-high-entropy-master-key-32-chars-min"
export ANX_VAULT_PATH="/var/lib/agent-nexus/vault.json"
```

---

[← Previous: Key Rotation & Cooldown](08-key-rotation-and-cooldown.md) | [Index](01-introduction-and-overview.md) | [Next: Universal Local Agent Bridge →](10-universal-local-agent-bridge.md)
