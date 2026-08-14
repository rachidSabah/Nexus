# NEXUS Transport Architecture

Nexus separates **routing/failover logic** from **network transport**. The
transport layer is pluggable but defaults to **direct connection**.

## Transport abstraction

```
                    ┌─────────────────────────────┐
   Agent / App  ──▶ │      Nexus Gateway           │
                    │  RoutingEngine → Adapter     │
                    │  KeyRegistry (rotation)      │
                    │  FailoverEngine (circuit)    │
                    └──────────────┬──────────────┘
                                   │
                        ┌──────────▼──────────┐
                        │  NetworkPort (transport) │
                        └──────────┬──────────┘
              ┌────────────────────┼────────────────────┐
              ▼                                         ▼
     DirectTransportAdapter                  CustomProxyTransportAdapter
     (default, zero-config)                 (optional, admin-configured)
              │                                         │
              ▼                                         ▼
        Provider API (HTTPS)                     Proxy (HTTP/SOCKS)
```

## DirectTransportAdapter (default)

`DefaultNetworkService` with egress mode `DIRECT`:

- Connects straight to each provider's `baseUrl` over HTTPS.
- No proxy selection, no rotation, no health scoring of proxies.
- Works with **zero** configured proxies.

## CustomProxyTransportAdapter (optional)

- Only used when an administrator explicitly registers a proxy and switches the
  egress mode to `PROXY_PREFERRED` or `PROXY_ONLY`, or when a single request
  passes `proxyId`.
- Honors enterprise proxy configuration (e.g. corporate egress gateways).
- Never sourced from public proxy lists.

## SSRF defense retained

`addProxy()` runs every URL through `sanitizeUrl()`, which blocks:
- `localhost` / loopback (`127.0.0.0/8`, `::1`)
- RFC1918 private ranges (`10/8`, `172.16/12`, `192.168/16`)
- link-local / multicast / reserved ranges

So even a misconfigured custom proxy cannot point the gateway at an internal
service.

## Error classification (transport layer)

The KeyRegistry classifies every provider/key result:

| Status | Action |
| ------ | ------ |
| `401` | Mark credential invalid/revoked → removed from rotation immediately |
| `403` | Authorization failure → health penalty, not blindly retried |
| `429` | Key/model/provider cooldown → select another healthy key, then another model/provider |
| `408`/`timeout` | Health penalty, retry via another healthy candidate |
| `500/502/503/504` | Provider/model health penalty + circuit breaker |
| network failure | Transport health penalty, fail over |
| success | Recover health, reset consecutive-failure counters |
