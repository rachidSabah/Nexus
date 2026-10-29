---
'@anx/intelligence': minor
'@anx/gateway': minor
'@anx/core': patch
'@anx/security': patch
---

feat: AI Provider Intelligence OS

- **`@anx/intelligence` (new)**: continuous provider/model discovery via bounded connectors (OpenRouter, Hugging Face, GitHub, Local), redaction-first evidence storage, independent verification dimensions (existence, identity, pricing, capability, free), free-tier intelligence, leak monitoring (secrets redacted before storage, never tested), constrained adapter generation and hash-bound human-approved publishing.
- **`@anx/gateway`**: `/v1/intelligence/*` routes with RBAC (`intelligence:discover|write|approve|publish`), new audit events, optional `HttpServerDeps.intelligence` wiring, `discovery` subsystem in the health aggregator and an approved-only publish hook into routing + the model registry.
- **`@anx/core`**: `SubsystemName` gains `discovery` (subsystem #15) in the health hierarchy.
- **`@anx/security`**: intelligence permissions and default roles.
