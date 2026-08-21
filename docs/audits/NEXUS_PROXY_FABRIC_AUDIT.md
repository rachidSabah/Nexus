# NEXUS PROXY FABRIC AUDIT REPORT

## Executive Summary
This audit inspects the current proxy subsystem in Nexus (`@anx/networking` and `@anx/gateway`), analyzing why discovered public proxies fail health checks, report artificial 1 ms latency, and remain in a `DEAD` state (e.g. 83 total / 0 active / 83 dead).

---

## 1. Current Subsystem Architecture

The existing network and proxy implementation spans the following core files:

- **Package:** `@anx/networking` ([`packages/networking/src/index.ts`](file:///E:/CodingGhost/packages/networking/src/index.ts))
  - `ProxyConfig`: Explicit proxy configuration interface.
  - `ScrapedProxy`: Simple proxy descriptor with fields (`id`, `url`, `type`, `latencyMs`, `lastCheckedAt`, `successCount`, `failCount`, `status`).
  - `ProxyPoolManager`: Auto-scraper and in-memory pool storing up to 200 entries.
    - Scrapes ~13 hardcoded URLs (raw txt and JSON formats).
    - `verifyProxy(proxyUrl)`: Uses `undici.ProxyAgent(proxyUrl)` to send a `HEAD` request to `this.targetCheckUrl` (`https://www.google.com`).
    - `scrapeAndVerify()`: Shuffles candidate IP:ports and attempts parallel verification.
    - `reportResult(id, success, latencyMs)`: Basic adaptive latency calculation.
  - `DefaultNetworkService`: Implements `NetworkPort` interface.
    - Runs `diagnose()` checking DNS, IPv4 socket (`https://1.1.1.1`), IPv6 socket (`https://[2606:4700:4700::1111]`), and custom proxies.
- **Gateway Server:** [`apps/gateway/src/server.ts`](file:///E:/CodingGhost/apps/gateway/src/server.ts)
  - Exposed endpoints:
    - `GET /v1/network/diagnostics`
    - `POST /v1/network/proxy-pool/scrape`
    - `POST /v1/network/proxy-pool/add`
- **Dashboard UI:** [`apps/dashboard/src/app/network/page.tsx`](file:///E:/CodingGhost/apps/dashboard/src/app/network/page.tsx)
  - Displays DNS, IPv4, IPv6, Active Proxy count, and proxy matrix table.

---

## 2. Root Cause Analysis of Observed Failures

### Root Cause 1: Artificial 1ms Latency & Flawed Latency Measurement
In [`packages/networking/src/index.ts`](file:///E:/CodingGhost/packages/networking/src/index.ts#L235):
```ts
const checkStarted = Date.now();
// Inside worker loop:
const added = this.addProxy(url, proto);
const ok = await this.verifyProxy(url);
added.latencyMs = Date.now() - checkStarted;
```
`checkStarted` was declared **outside** the worker loop before processing all candidates. For candidate #20 evaluated 1 millisecond into execution, `Date.now() - checkStarted` resulted in `1ms`, even when `verifyProxy` threw an error immediately! The system recorded `1ms` for failed proxies instead of recording exact TCP, TLS, or HTTP breakdown, or setting `null`/`-1`.

### Root Cause 2: Failure to Distinguish Network Unreachability & Untrusted Public Proxies
Public free proxy lists contain >95% stale or offline IP:ports. The existing verification tried sending a full `fetch()` request over `undici.ProxyAgent`. When the TCP socket timed out or was refused, `verifyProxy` caught the error and marked `added.status = 'dead'`, but did not classify *why* (e.g. `TCP_TIMEOUT`, `TCP_REFUSED`, `TLS_FAILURE`).

### Root Cause 3: False Negative IPv4 Socket Check (`https://1.1.1.1`)
In `checkIp('https://1.1.1.1')`:
Cloudflare's `1.1.1.1` IP endpoint over raw HTTPS `https://1.1.1.1` fails TLS certificate verification or times out under Node's `fetch` unless SNI or strict IP cert handling is bypassed. Thus, `checkIp('https://1.1.1.1')` returned `ok: false`, causing the dashboard to report `IPv4 Socket: UNREACHABLE` even though direct IPv4 internet connectivity was completely functional.

### Root Cause 4: IPv6 Unavailability Misreported as Failure
`checkIp('https://[2606:4700:4700::1111]')` marked `ok: false` for environments without native IPv6 routing, presenting it as an engine error rather than reporting `IPv6: UNAVAILABLE`.

---

## 3. Affected Modules & Compatibility Constraints

1. `packages/networking/src/index.ts` — Requires complete replacement of `ProxyPoolManager` with a multi-layered `NetworkEgressFabric`.
2. `packages/core/src/domain/types.ts` & `packages/core/src/application/ports.ts` — Needs rich `ProxyEndpoint` domain models and egress modes (`DIRECT`, `PROXY_PREFERRED`, `PROXY_ONLY`, `AUTO`).
3. `apps/gateway/src/server.ts` — Require expanded API routes (`/v1/network/proxies`, `/v1/network/proxies/active`, `/v1/network/proxies/health`, `/v1/network/proxies/discover`, `/v1/network/proxies/:id/test`, `/v1/network/proxies/:id/enable`, `/v1/network/proxies/:id/disable`, `/v1/network/proxies/:id/quarantine`, `/v1/network/diagnostics`, `/v1/debug/network-egress`, `/v1/debug/network-egress/events`).
4. `apps/dashboard/src/app/network/page.tsx` — Update UI to present truthful verification states (`DISCOVERED`, `TESTING`, `HEALTHY`, `DEGRADED`, `DEAD`, `QUARANTINED`, `DISABLED`), accurate TCP/HTTPS latency breakdowns, and egress mode controls.

---

## 4. Proposed Replacement Architecture

We will implement a modular Network Egress Fabric:
- **ProxyEndpoint Domain Model:** Comprehensive metadata, explicit latency breakdown (`tcpLatencyMs`, `tlsLatencyMs`, `httpLatencyMs`), state machine, health score, and SSRF security flags.
- **Provider-Based Discovery System (`ProxyDiscoveryProvider`):** Modular providers (GitHub feeds, public proxy APIs, manual configs) deduplicating by `protocol + host + port`.
- **Layered 5-Stage Verification Engine:**
  1. SSRF & Security Sanity Check (block loopback, RFC1918, link-local, broadcast).
  2. TCP Connect (measure `tcpLatencyMs`).
  3. HTTP Proxy / HTTPS CONNECT Tunnel Test (measure `tlsLatencyMs`).
  4. Real Target Verification (measure `httpLatencyMs` against deterministic external endpoint).
  5. Response Validation (status < 500, header sanity check).
- **Health Scorer & Egress Rotator:** Weighted selection based on `healthScore * successRate * latencyFactor`, with cooldown protection and reuse interval constraints.
- **Independent Failure Domain:** Network proxy failures do not affect API model, key, or provider health.

---

## 5. Architectural Verification & Compatibility Plan
- Preserve all existing `RoutingEngine` model routing, key rotation, and circuit breakers.
- Maintain full compatibility with Claude Code, Codex, and Gemini CLI gateway traffic.
