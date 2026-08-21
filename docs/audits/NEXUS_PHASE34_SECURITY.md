# Nexus Phase 34: Security & Safety Guardrails

## 1. Zero-Command-Execution Guarantee

Self-healing in Nexus is strictly bounded to domain-specific internal state transitions. Nexus explicitly prohibits:

- **No Shell Execution**: No automated spawning of shell processes (`sh`, `bash`, `cmd.exe`, `powershell`).
- **No Package Installation**: Nexus will never run package managers (`apt`, `npm`, `pnpm`, `pip`, `cargo`, `brew`) to resolve missing agent dependencies.
- **No Filesystem Destruction**: Self-healing never deletes workspaces, user files, mission checkpoints, or persistent databases.
- **No Security Bypasses**: Self-healing cannot alter RBAC policies, disable JWT/API key validation, or suppress security audit logging.

---

## 2. Secret Redaction & Sanitization

All telemetry signals, anomaly evidence, diagnosis reports, and incident logs are sanitized through the automated redaction engine:

- **API Keys**: Pattern matching on `sk-[a-zA-Z0-9_-]{10,}` $\longrightarrow$ `[REDACTED_API_KEY]`.
- **Authorization Tokens**: Pattern matching on `Bearer [a-zA-Z0-9._-]{10,}` $\longrightarrow$ `Bearer [REDACTED_TOKEN]`.
- **Sensitive Metadata**: Keys named `password`, `secret`, `key`, or `token` are automatically obscured before entering SQLite persistence or SSE telemetry streams.

---

## 3. Persistent Audit Logging

All incident transitions and remediation actions generate cryptographic or structured records in the SQLite `runtime_incidents` table and `audit_log`:

```sql
CREATE TABLE IF NOT EXISTS runtime_incidents (
  id TEXT PRIMARY KEY,
  subsystem TEXT NOT NULL,
  status TEXT NOT NULL,
  severity TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Operators have full visibility through `/v1/system/incidents` and `/v1/system/intelligence` with complete traceability back to correlation IDs and originating request traces.
