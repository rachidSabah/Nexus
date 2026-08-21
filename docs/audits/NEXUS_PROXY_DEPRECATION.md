# NEXUS Proxy Deprecation

**Status: DEPRECATED — public proxy scraping removed from the request path.**

Nexus is now a **universal provider / API-key / model routing fabric**. It does
**not** depend on scraped public or free proxy servers for provider connectivity.

## What changed

| Before | After |
| ------ | ----- |
| `NetworkEgressFabric` default egress mode `AUTO` | Default egress mode `DIRECT` |
| Background auto-scraper pulled public proxy lists (Proxyscrape, GitHub feeds) on startup | Auto-scrape **disabled by default**; public discovery providers remain behind an explicit opt-in (`enablePublicDiscovery()`) |
| `DefaultNetworkService` started a background scraper in its constructor | Constructor performs **no** background scraping; only honors administrator-configured custom proxies |
| `fetch()` selected a proxy automatically on nearly every call | `fetch()` connects **directly** unless a custom proxy is explicitly requested (`proxyId`, `rotateProxy`, or mode `PROXY_PREFERRED`/`PROXY_ONLY`) |
| Dashboard "Network" page centered on a public-proxy pool (83 discovered / 0 healthy / 83 dead) | Dashboard "Network & Transport" page centers on **Direct Connectivity**, DNS, IPv4/IPv6, transport mode, and per-provider connectivity |

## Operational guarantee

```
ACTIVE_PROXY_COUNT = 0  →  Nexus operates normally.
```

No request fails merely because the proxy pool is empty. The production path is:

```
Agent
  ↓
Nexus Gateway
  ↓
Routing Engine
  ↓
Provider Adapter
  ↓
Key Registry (health-aware rotation)
  ↓
Direct Transport
  ↓
Provider API
```

## Proxy modes (supported)

- `disabled` (default for public scraping) — no public proxies.
- `custom` — an administrator may register an explicit proxy via
  `POST /v1/network/proxy-pool/add`. It is only used when the egress mode is
  set to `PROXY_PREFERRED` or `PROXY_ONLY`, or when a request explicitly passes
  `proxyId`.
- Enterprise custom-proxy support remains; public proxy scraping is **never**
  re-introduced.

## Why

Public proxy lists are unreliable: they frequently report "healthy" based only on
TCP connectivity, inject latency, break streaming, and create false availability
signals (the old subsystem reported 0 active / 83 dead). Direct provider
connectivity plus intelligent key/model/provider failover is the correct
production architecture.
