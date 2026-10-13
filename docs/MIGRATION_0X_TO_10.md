# Migration Guide: 0.x to 1.0

This guide details the architectural evolutions, breaking changes, deprecation mitigations, and configuration steps when upgrading from Agent Nexus Gateway `v0.x` to `v1.0.0`.

---

## 1. Executive Summary

Agent Nexus Gateway `v1.0.0` solidifies enterprise readiness, predictable SemVer commitments, and LTS support while preserving local-first principles.

### Key Milestones Shipped:
- **v0.2.0 (Caching & Telemetry)**: Vector similarity semantic cache (`PgVectorSemanticCache`), prompt-cache passthrough, tiktoken token accounting, Alertmanager & Grafana configurations.
- **v0.3.0 (Workflows & RAG)**: Directed Acyclic Graph (DAG) workflow engine (`runDagExecution`) supporting parallel branch evaluation, vector store adapters, prompt template registries, and scoped memory primitives (`SessionMemory`, `UserMemory`, `AgentMemory`).
- **v0.4.0 (Multi-Agent & Knowledge Graphs)**: Agent role topologies (`planner`, `executor`, `critic`, `observer`), A2A message signing, broadcast/pub-sub coordination, and Curated MCP Server Registry.
- **v0.5.0 (Cloud Providers)**: Azure OpenAI streaming fixes, Cloudflare Workers AI native adapter, Perplexity, and Replicate OpenAI-compatible adapters.
- **v0.6.0 (Performance & Scale)**: Sub-millisecond precomputed routing tables, speculative parallel racing, and batch job orchestration.
- **v0.7.0 (Security & Compliance)**: RS256/EdDSA asymmetric JWTs, OAuth 2.0 (Client Credentials & Authorization Code), SAML 2.0 SSO, SCIM 2.0 user provisioning, and automated PII redaction.
- **v0.8.0 - v0.9.0 (Desktop & Native Integrations)**: VM sandbox isolation, cryptographic plugin signing, Desktop Tray Controller, and zero-config harnesses for Claude Code, Codex, Zed, Cursor, OpenHands, and terminal editors.
- **Beyond 1.0 (High Throughput & Intelligence)**: Quality benchmark routing, pre-flight cost estimation, budget guards, and Rust/Wasm foundation abstractions.

---

## 2. Breaking Changes & Deprecations

### 2.1 Workflow Steps: `dependsOn` DAG Graph
In `v0.2.x`, workflows executed linearly as sequential steps.
In `v1.0.0`, `WorkflowStep` supports optional `dependsOn: string[]`.
- **Legacy behavior**: If `dependsOn` is omitted, steps execute sequentially.
- **New behavior**: `runDagExecution()` resolves dependencies as a directed acyclic graph and dispatches ready steps in parallel via `Promise.all`.

```typescript
// Migration Example
const workflow = {
  id: 'wf-analysis',
  steps: [
    { id: 'fetch-data', action: 'extract' },
    { id: 'summarize', action: 'llm', dependsOn: ['fetch-data'] },
    { id: 'sentiment', action: 'llm', dependsOn: ['fetch-data'] }, // Runs in parallel with 'summarize'
    { id: 'report', action: 'combine', dependsOn: ['summarize', 'sentiment'] },
  ]
};
```

### 2.2 JWT Verification Interface
In `v0.x`, only HS256 symmetric signing was natively supported via `JwtService`.
In `v1.0.0`, production enterprise deployments should use `AsymmetricJwtHandler`:

```typescript
// Legacy HS256:
import { JwtService } from '@anx/security';
const jwt = new JwtService(secret);

// Modern RS256 / EdDSA in v1.0.0:
import { AsymmetricJwtHandler } from '@anx/security';
const handler = new AsymmetricJwtHandler(privateKeyPem, publicKeyPem);
const token = handler.issueRs256({ sub: 'user-123' });
```

### 2.3 Memory Primitives
The unified memory interface in `v1.0.0` uses explicit scopes:
- `SessionMemory`: ephemeral per conversation session.
- `UserMemory`: durable per user across sessions.
- `AgentMemory`: private scratchpad per agent instance.

---

## 3. Configuration & Deployment Updates

### 3.1 Environment Variables
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `AGENT_NEXUS_VAULT_KEY` | None (ephemeral) | Master encryption key for AES-256-GCM vault |
| `ANX_ENABLE_PII_REDACTION` | `false` | Enable automatic PII masking before upstream dispatch |
| `ANX_SEMANTIC_CACHE_PROVIDER` | `memory` | Set to `pgvector` to enable vector persistence |

### 3.2 Upgrading Plugins
Untrusted plugins should be loaded and evaluated via `SandboxedPluginRunner` to prevent host pollution. Sign all production plugin manifests with `VerifiablePluginSigner` using enterprise RSA keys.

---

## 4. Verification Checklist
- [x] Run `pnpm test` across all packages to verify test suite passing.
- [x] Verify gateway responds on port `19808` (`/health` and `/v1/models`).
- [x] Ensure all credential vault keys have been safely backed up or migrated.
