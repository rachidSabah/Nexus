# Nexus — Wiki Home

Welcome to the Nexus wiki. Nexus is a **local-first AI coding-agent gateway, provider fabric, and autonomous control plane** that exposes 300+ models through one OpenAI-compatible endpoint (`http://127.0.0.1:8787`).

## Start here
- **[Quick Start & Installation](03-quickstart-and-installation.md)** — one-line install (Windows / Linux / macOS) and uninstall that removes all Nexus packages, the vault, and the `anx` CLI.
- **[Repository README](https://github.com/rachidSabah/Nexus#readme)** — architecture, feature matrix, and the OmniRoute competitive edge.

## What Nexus does
- **Universal Provider Fabric:** connect any OpenAI-compatible provider once; Nexus discovers models, normalizes capabilities, encrypts keys, and creates routing bindings.
- **Dynamic Model Discovery:** every model from every configured provider, automatically — zero hardcoded catalogs.
- **Intelligent Routing:** `nexus/best-coding`, `nexus/free`, `nexus/fast`, `nexus/reasoning`, plus pluggable strategies (priority / round-robin / weighted / least-used).
- **Multi-Key Rotation & Failover:** rotates keys, isolates 429s, fails over model → key → provider.
- **Token Optimization:** six-engine prompt compression with real, measured per-engine savings — no fabricated percentages.
- **MCP Server:** exposes real Nexus capabilities (models, free-tier, stats, routing, compression, memory, A2A status, guardrails) over JSON-RPC.
- **Legitimate proxy passthrough:** direct egress by default, SSRF-guarded, admin-opt-in custom proxy only — no MITM/stealth.

## Honest status (v0.5.0)
- **A2A:** wire protocol + message routing implemented; full multi-agent orchestration is next-release.
- **Persistent memory** and **guardrails** are implemented and exposed via MCP.
- **Electron:** not built — the dashboard is installable as a PWA.

## Releases
See the [Releases](https://github.com/rachidSabah/Nexus/releases) page. Current: **v0.5.0**.

---
*This wiki is maintained alongside the main repository. For issues and feature requests, use the GitHub [Issues](https://github.com/rachidSabah/Nexus/issues) tracker.*
