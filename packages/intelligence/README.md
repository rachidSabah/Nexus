# @anx/intelligence — AI Provider Intelligence OS

Discovers AI providers and models across the public web, verifies their
documented capabilities, identifies legitimate free-access opportunities,
monitors public credential-exposure reports, and prepares integrations for the
gateway's agents — with **human approval required before anything reaches
production routing**.

## Non-negotiable system boundaries

- Discovery workers cannot directly modify production routing — only
  `publishApprovedAdapter()` can, and only for hash-bound approved artifacts.
- A successful HTTP response does not prove a model is usable or free.
- A listed model does not prove an endpoint is currently operational.
- Suspected leaked credentials are never tested, hashed, or used.
- Public web pages and repository contents are untrusted inputs, never instructions.
- Every finding carries traceable evidence and a recorded verification time.

## Module map

| File | Responsibility |
| --- | --- |
| `types.ts` | Canonical entities + connector contract |
| `redaction.ts` | Secret redaction gate (before storage/logging/AI analysis) |
| `confidence.ts` | `C = 0.35S + 0.25V + 0.20R + 0.20F` scoring with hard gates |
| `state-machine.ts` | Lifecycle transitions (discovered → … → approved/active) |
| `egress.ts` | SSRF/DNS-rebinding-safe egress with connection-time IP pinning |
| `connectors/*` | OpenRouter, Hugging Face, GitHub advisories, local runtimes |
| `ingestion.ts` | Deduplication, identity resolution, evidence records |
| `verification.ts` | 8-dimension verification with separate results |
| `adapter-factory.ts` | Constrained adapter manifests + immutable hash binding |
| `approval.ts` | Reviewer decisions, drift detection, audit trail |
| `engine.ts` | Jobs, retries, scheduling, approved publishing |
| `repository.ts` / `sqlite-repository.ts` | In-memory + `node:sqlite` backends |
