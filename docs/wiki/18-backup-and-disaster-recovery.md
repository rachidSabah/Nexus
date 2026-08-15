# 18 — Backup & Disaster Recovery

[← Previous: Idempotency & Side-Effect Safety](17-idempotency-and-side-effect-safety.md) | [Index](01-introduction-and-overview.md) | [Next: Operations Control Plane →](19-operations-control-plane.md)

---

## Cryptographic Backup Engine

The `BackupRestoreEngine` (`packages/persistence/src/index.ts`) creates standalone, portable JSON backup bundles protected by **SHA-256 integrity checksums**.

### Backup Bundle Contents

```json
{
  "schemaVersion": 2,
  "nexusVersion": "0.5.0",
  "createdAt": "2026-08-15T08:00:00.000Z",
  "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "data": {
    "endpoints": [ ... ],
    "models": [ ... ],
    "keyMetadata": [ ... ],
    "missions": [ ... ],
    "checkpoints": [ ... ],
    "agentExecutions": [ ... ],
    "auditLogs": [ ... ]
  }
}
```

*Note: Secrets and credentials are fundamentally excluded from the backup bundle to maintain zero-leak security guarantees.*

---

## Backup & Restore via REST API

### Trigger System Backup
```http
POST /v1/system/backup
```

### Restore System Backup
```http
POST /v1/system/restore
Content-Type: application/json

{
  "schemaVersion": 2,
  "nexusVersion": "0.5.0",
  "createdAt": "2026-08-15T08:00:00.000Z",
  "checksum": "...",
  "data": { ... }
}
```

---

[← Previous: Idempotency & Side-Effect Safety](17-idempotency-and-side-effect-safety.md) | [Index](01-introduction-and-overview.md) | [Next: Operations Control Plane →](19-operations-control-plane.md)
