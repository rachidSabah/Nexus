# 23 — Security, RBAC & Isolation

[← Previous: Production Operations Dashboard](22-production-operations-dashboard.md) | [Index](01-introduction-and-overview.md) | [Next: Token Efficiency & Compression →](24-token-efficiency-and-prompt-compression.md)

---

## Role-Based Access Control (RBAC)

Nexus enforces default-deny role-based authorization via `PolicyEngine` (`apps/gateway/src/security-fabric.ts`):

- **`admin`**: Full system control, provider registration, backup/restore, operator actions.
- **`developer`**: Mission creation, chat completions, agent executions.
- **`operator`**: Health diagnostics, key self-healing, model discovery.
- **`viewer`**: Read-only metrics and dashboard telemetry.

---

## Tenant Context & Workspace Isolation

1. **Correlation & Tenant Context**: Propagates `tenantId`, `userId`, `requestId`, `traceId` across all internal events and child subprocesses.
2. **Workspace Boundary Guard**: Agents can only execute within explicit project workspace directories. Directory traversal (`..`) is strictly blocked at the API gateway boundary.

---

[← Previous: Production Operations Dashboard](22-production-operations-dashboard.md) | [Index](01-introduction-and-overview.md) | [Next: Token Efficiency & Compression →](24-token-efficiency-and-prompt-compression.md)
