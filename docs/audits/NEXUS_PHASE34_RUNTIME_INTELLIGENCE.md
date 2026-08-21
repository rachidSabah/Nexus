# Nexus Phase 34: Runtime Intelligence & Anomaly Detection

## Executive Overview

Nexus Phase 34 transforms the control plane from an **Observe & Report** paradigm into a bounded, autonomous, deterministic loop:

$$\text{OBSERVE} \longrightarrow \text{DETECT} \longrightarrow \text{DIAGNOSE} \longrightarrow \text{DECIDE} \longrightarrow \text{SAFELY REMEDIATE} \longrightarrow \text{VERIFY} \longrightarrow \text{REPORT}$$

Nexus continuously analyzes runtime signals across all 14 platform subsystems without imposing external heavy observability systems or costly LLM-in-the-loop dependencies for anomaly detection.

---

## 1. Monitored Subsystems (14-Point Health Grid)

The Runtime Intelligence engine continuously tracks real-time signals across the following domains:

1. **`gateway`**: HTTP latency distributions, throughput (RPS), error distributions, active in-flight requests, streaming drops.
2. **`providers`**: Latency EWMA, success rate, status code breakdowns ($401, 402, 404, 429, 5xx$), upstream timeout frequencies.
3. **`models`**: Per-model availability, inference latency, capability mismatch, stale model state detection.
4. **`keys`**: Cooldown enforcement, rate exhaustion patterns, authentication failures, quota tracking.
5. **`routing`**: Routing latency, scoring variance, candidate availability, deprioritization state.
6. **`failover`**: Multi-tier failover triggers, cascade depth, fallback exhaustion.
7. **`circuitBreaker`**: Circuit states (`HEALTHY`, `DEGRADED`, `OPEN`, `HALF_OPEN`, `RECOVERED`), failure counters.
8. **`localAgents`**: CLI binary availability, smoke test execution health, agent process timeouts, lease status.
9. **`missions`**: DAG execution status, stalled tasks, repair loop exhaustion, checkpoint freshness.
10. **`agentExecutions`**: Execution process health, orphaned execution leases, run lifecycle tracking.
11. **`persistence`**: SQLite WAL latency, migration status, backup generation, integrity verification.
12. **`networking`**: Direct transport status, DNS resolution, IPv4/IPv6 reachability, upstream connectivity.
13. **`tokenEfficiency`**: Token compression ratios, cache hit percentages, token spend anomalies.
14. **`security`**: RBAC violations, SSRF blocks, auth failures, audit trail health.

---

## 2. Statistical Anomaly Detection

Detection uses **deterministic statistical thresholds, sliding time-windows, and exponential weighting** rather than unpredictable LLM prompts:

| Anomaly Identifier | Subsystem | Default Threshold | Severity |
|---|---|---|---|
| `RATE_LIMIT_SPIKE` | `providers` / `keys` | $\ge 3$ 429s in 60s | `HIGH` / `CRITICAL` ($\ge 6$) |
| `AUTH_FAILURE_SPIKE` | `security` / `keys` | $\ge 2$ 401s in 60s | `HIGH` |
| `LATENCY_SPIKE` | `gateway` / `providers` | p95 latency $> 4000\text{ms}$ | `MEDIUM` / `HIGH` |
| `ERROR_RATE_SPIKE` | `gateway` / `providers` | Error rate $> 30\%$ | `HIGH` |
| `PROVIDER_DEGRADED` | `providers` | $\ge 3$ failures in 60s | `HIGH` |
| `MODEL_DEGRADED` | `models` | $\ge 2$ model 404/410 in 60s | `MEDIUM` |
| `AGENT_DEGRADED` | `localAgents` | $\ge 3$ execution failures in 60s | `HIGH` |
| `AGENT_UNAVAILABLE` | `localAgents` | Binary missing or probe failed | `HIGH` |
| `MISSION_STALLED` | `missions` | In-progress without checkpoint in 5m | `HIGH` |
| `MISSION_FAILURE_SPIKE` | `missions` | $\ge 3$ mission failures in 60s | `HIGH` |
| `REPAIR_LOOP_EXHAUSTION`| `missions` | Repair attempts $\ge \text{max}$ | `CRITICAL` |
| `PERSISTENCE_DEGRADED` | `persistence` | Database error detected | `CRITICAL` |
| `NETWORK_DEGRADED` | `networking` | Connectivity probe fails | `HIGH` |
| `TOKEN_COST_SPIKE` | `tokenEfficiency` | Cost $> \$1.00$ in 1m window | `MEDIUM` |
| `KEY_EXHAUSTION_PATTERN`| `keys` | 402 payment/quota errors $\ge 2$ | `HIGH` |
| `ROUTING_DEGRADED` | `routing` | Zero eligible candidates | `CRITICAL` |

---

## 3. Diagnosis Engine

When an anomaly is flagged, the **Diagnosis Engine** builds an evidence-backed root cause report:

```typescript
export interface RuntimeDiagnosis {
  incidentId: string;
  subsystem: SubsystemName;
  signal: string;
  severity: IncidentSeverity;
  probableCause: string;
  evidence: string[];
  confidence: number; // 0.0 - 1.0
  recommendedRemediation: RemediationActionType;
  autoRemediationPermitted: boolean;
  policyTier: RemediationPolicyTier; // AUTO_SAFE | APPROVAL_REQUIRED | NEVER_AUTOMATE
}
```

### Deterministic Reasoning Rules:
- **Provider 429 Spike**: Identifies provider rate limit; checks key cooldown; calculates alternative routing candidates; recommends `DEPRIORITIZE_PROVIDER`.
- **Model 404 Retires**: Verifies catalog entry; marks model stale in registry; schedules background rediscovery via `MARK_STALE_MODEL`.
- **Agent Degraded/Offline**: Inspects executable availability; verifies PATH; triggers health probe via `PROBE_AGENT_HEALTH` without attempting unauthorized software installation.
- **Mission Stalled**: Inspects lease timeout; recommends safe reconciliation via `RECONCILE_MISSION_STATE`.
- **Database/Persistence Degraded**: Automatically flags `NEVER_AUTOMATE` policy tier; immediately escalates to operator without destructive data operations.

---

## 4. Adaptive Routing & Explainability

Runtime Intelligence directly informs the multi-tier Scoring Engine. When a provider or model degrades:
1. It is deprioritized in the scoring matrix with explanatory notes.
2. The `/v1/routing/explain` endpoint surfaces explicit reasons:
   - `whySelected`: Explanation of capability match and latency score.
   - `whyDeprioritized`: e.g., `"Provider [provider-alpha] temporarily degraded/rate-limited"`.
   - `whyRecovered`: e.g., `"Verified healthy with active key rotation"`.
   - `whyRejected`: Hard disqualification criteria.
