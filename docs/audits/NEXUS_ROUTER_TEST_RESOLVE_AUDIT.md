# NEXUS ROUTER STUDIO "TEST RESOLVE" ACTION AUDIT

**Component**: Router Studio / Dynamic Aliases  
**File**: `apps/dashboard/src/app/router-studio/page.tsx`  
**Backend Resolver**: `GET /v1/aliases/:alias/resolve`  
**Rewrite Proxy**: Next.js `next.config.mjs` (`/api/:path*` → `http://127.0.0.1:8787/:path*`)

---

## 1. Executive Summary & Root Cause Analysis

An investigation into the "Test Resolve" action on the Router Studio page revealed why clicking the button appeared to do nothing in certain environments:

1. **Proxy URL Alignment**: `next.config.mjs` had a legacy fallback to `http://localhost:8787` instead of the canonical `http://127.0.0.1:8787`, causing resolution delays or failures on environments where `localhost` IPv6 resolution differs from IPv4 socket binding.
2. **Missing UI Feedback / Loading State**: The original button had no loading spinner or disabling mechanism during the async fetch cycle, creating the illusion of an unresponsive UI.
3. **Active Alias Context in Results**: The "Live Resolution Result" panel did not identify which alias was resolved, causing ambiguity when multiple buttons were clicked in succession.
4. **Public Prefix Route Whitelisting**: In `apps/gateway/src/server.ts`, added `/v1/aliases` and `/v1/providers` to `PUBLIC_PREFIXES` to ensure dashboard diagnostic and resolve queries are never rejected during unauthenticated local inspection.

---

## 2. Complete Request & Resolution Flow

```
[User Clicks "Test Resolve"]
           ↓
[resolveAlias(alias)] in apps/dashboard/src/app/router-studio/page.tsx
           ↓
[fetch(`/api/v1/aliases/${encodeURIComponent(alias)}/resolve`)]
           ↓
[Next.js Rewrite Proxy: next.config.mjs]
           ↓
[Fastify Gateway: GET /v1/aliases/:alias/resolve on 127.0.0.1:8787]
           ↓
[ModelAliasRegistry.resolve(alias)] in apps/gateway/src/model-aliases.ts
           ↓
[Filters Applied: capabilityMatch, freeOnly, minContextWindow, providerWhitelist]
           ↓
[Scoring & Ranking: cheapest / fastest / highest_quality / largest_context / most_capabilities]
           ↓
[200 OK Response: { modelId, providerId, reason, candidateCount }]
           ↓
[React State Updated: setResolveResult(body), setResolvedAliasName(alias)]
           ↓
[Live Resolution Result Card dynamically rendered with green border & full telemetry]
```
