# 31 — Troubleshooting & Runbooks

[← Previous: Configuration & Environment Variables](30-configuration-and-environment-variables.md) | [Index](01-introduction-and-overview.md) | [Next: Contributing & Plugin Development →](32-contributing-and-plugin-development.md)

---

## Standard Runbooks

### Runbook 1: In-Flight Mission Interrupted by Power Outage / Crash
1. Restart the Nexus Gateway (`pnpm start` or systemd service restart).
2. The `CrashRecoveryEngine` will automatically reconcile DAG tasks from the last checkpoint.
3. Query `GET /v1/system/recovery` to verify status.
4. If `reconciliationStatus` is `REQUIRES_OPERATOR`, issue:
   ```http
   POST /v1/system/recovery/reconcile
   {"missionId": "<id>", "action": "RESUME"}
   ```

### Runbook 2: Provider API Key Hit Rate Limit (429)
1. The gateway automatically places the affected key in 60-second cooldown and routes to the next key.
2. If all keys for a provider are exhausted, the gateway dynamically fails over to alternative providers.
3. To manually clear a cooldown:
   ```http
   POST /v1/keys/<key-id>/heal
   ```

---

[← Previous: Configuration & Environment Variables](30-configuration-and-environment-variables.md) | [Index](01-introduction-and-overview.md) | [Next: Contributing & Plugin Development →](32-contributing-and-plugin-development.md)
