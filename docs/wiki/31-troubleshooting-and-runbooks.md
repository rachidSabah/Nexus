# 31 — Troubleshooting & Runbooks

[← Previous: Configuration & Environment Variables](30-configuration-and-environment-variables.md) | [Index](01-introduction-and-overview.md) | [Next: Contributing & Plugin Development →](32-contributing-and-plugin-development.md)

---

## Comprehensive Production & Local Troubleshooting

This guide provides structured root-cause diagnostic workflows formatted as **SYMPTOM → CAUSE → DIAGNOSTIC → SOLUTION**.

---

### 1. Gateway Unavailable / Port Conflict

- **SYMPTOM**: `curl: (7) Failed to connect to 127.0.0.1 port 8787: Connection refused` or `EADDRINUSE: address already in use 127.0.0.1:8787`.
- **CAUSE**: Another process (e.g. previous gateway instance, zombie process) is holding port 8787, or host binding failed.
- **DIAGNOSTIC**:
  ```bash
  # Windows PowerShell
  Get-NetTCPConnection -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object OwningProcess
  
  # Linux / macOS / WSL
  lsof -i :8787 || ss -tulpn | grep 8787
  ```
- **SOLUTION**:
  ```bash
  # Terminate occupying process (replace <PID>)
  Stop-Process -Id <PID> -Force  # Windows
  kill -9 <PID>                  # Linux / macOS
  
  # Or start gateway on alternative port:
  AGENT_NEXUS_PORT=8788 pnpm start
  ```

---

### 2. Provider Authentication Failure (401 / 403)

- **SYMPTOM**: Gateway returns `401 Unauthorized` or upstream provider logs authentication error.
- **CAUSE**: Expired API key, invalid master vault key, or corrupted key record.
- **DIAGNOSTIC**:
  ```bash
  curl http://127.0.0.1:8787/v1/keys
  curl http://127.0.0.1:8787/v1/system/diagnostics
  ```
- **SOLUTION**:
  ```bash
  # Re-register healthy key with label:
  curl -X POST http://127.0.0.1:8787/v1/keys \
    -H "Content-Type: application/json" \
    -d '{"providerId": "anthropic", "plaintext": "sk-ant-api03-...", "label": "Primary"}'
  ```

---

### 3. Provider Hit Rate Limit (429 Too Many Requests)

- **SYMPTOM**: Upstream provider returns HTTP 429; responses show degraded latency or switch to fallback models.
- **CAUSE**: Exceeded upstream tokens/minute (TPM) or requests/minute (RPM) quotas.
- **DIAGNOSTIC**:
  ```bash
  curl http://127.0.0.1:8787/v1/keys
  # Check key status: "cooldown", cooldownUntil timestamp
  ```
- **SOLUTION**:
  Nexus automatically places the key in 60-second cooldown and routes traffic to alternative keys or providers. To manually clear:
  ```bash
  curl -X POST http://127.0.0.1:8787/v1/keys/<key-id>/heal
  ```

---

### 4. Provider Quota Exhaustion (402 Payment Required)

- **SYMPTOM**: Provider returns 402 or billing balance depleted error.
- **CAUSE**: Account credit balance reached zero on upstream cloud provider.
- **DIAGNOSTIC**:
  ```bash
  curl http://127.0.0.1:8787/v1/system/health
  # Check provider status: "unhealthy" with reason: "insufficient_quota"
  ```
- **SOLUTION**:
  Add credit balance on the upstream provider console or onboard a backup provider (`POST /v1/providers/onboard`).

---

### 5. Coding Agent Not Installed / Unhealthy

- **SYMPTOM**: Mission planner fails with `NO_AVAILABLE_AGENT` or `Agent 'claude-code' is not installed`.
- **CAUSE**: Coding agent CLI binary is not in system `$PATH` or failed executable check.
- **DIAGNOSTIC**:
  ```bash
  curl http://127.0.0.1:8787/v1/agents/health
  ```
- **SOLUTION**:
  ```bash
  # Install Claude Code globally
  npm install -g @anthropic-ai/claude-code
  
  # Or install OpenCode
  npm install -g opencode-ai
  ```

---

### 6. Interrupted Mission After Sudden Gateway Crash / Power Cut

- **SYMPTOM**: Gateway was killed during mission execution; mission was left in `EXECUTING` state.
- **CAUSE**: Process terminated unexpectedly before DAG tasks could mark completion.
- **DIAGNOSTIC**:
  ```bash
  curl http://127.0.0.1:8787/v1/system/recovery
  ```
- **SOLUTION**:
  The `CrashRecoveryEngine` automatically detects interrupted missions at startup. If manual intervention is needed:
  ```bash
  curl -X POST http://127.0.0.1:8787/v1/system/recovery/reconcile \
    -H "Content-Type: application/json" \
    -d '{"missionId": "<mission-id>", "action": "RESUME"}'
  ```

---

### 7. Backup / Restore Integrity Violation

- **SYMPTOM**: `POST /v1/system/restore` fails with `400 Backup integrity violation: checksum mismatch`.
- **CAUSE**: The backup JSON file was manually edited or corrupted in transit.
- **DIAGNOSTIC**:
  Recalculate SHA-256 over `backup.data`:
  ```bash
  node -e "const crypto=require('crypto'), b=require('./backup.json'); console.log(crypto.createHash('sha256').update(JSON.stringify(b.data)).digest('hex'))"
  ```
- **SOLUTION**:
  Ensure the `checksum` field exactly matches the SHA-256 digest of `data`.

---

### 8. Windows PowerShell Execution Policy Restrictions

- **SYMPTOM**: Running `install.ps1` gives `File ... cannot be loaded because running scripts is disabled on this system`.
- **CAUSE**: Windows default PowerShell execution policy is restricted.
- **DIAGNOSTIC**:
  ```powershell
  Get-ExecutionPolicy -Scope CurrentUser
  ```
- **SOLUTION**:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
  irm https://raw.githubusercontent.com/rachidSabah/codingghosts/main/install.ps1 | iex
  ```

---

### 9. WSL2 Localhost Networking Access

- **SYMPTOM**: Windows tools (Cursor / VSCode) cannot connect to Nexus running inside WSL2.
- **CAUSE**: WSL2 listening only on `127.0.0.1` inside Linux namespace or firewall rule blocking.
- **DIAGNOSTIC**:
  ```bash
  curl http://localhost:8787/ready
  ```
- **SOLUTION**:
  Start gateway with `AGENT_NEXUS_HOST=0.0.0.0` or configure `.wslconfig` with `networkingMode=mirrored`.

---

[← Previous: Configuration & Environment Variables](30-configuration-and-environment-variables.md) | [Index](01-introduction-and-overview.md) | [Next: Contributing & Plugin Development →](32-contributing-and-plugin-development.md)
