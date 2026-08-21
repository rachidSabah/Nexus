# Nexus — Launch Kit (honest edition)

Repo: https://github.com/rachidSabah/Nexus  (public, Apache-2.0)
Tagline: "Local-first AI gateway + multi-agent orchestrator. One endpoint for 300+ models, zero-cost routing to free tiers, real token compression, and self-healing reliability — no vendor lock-in."

---

## Hacker News (Show HN)

**Show HN: Nexus – local-first AI gateway that routes 300+ models and auto-falls back to free tiers**

I built Nexus because I was tired of rewiring agent code every time a provider changed a model ID or rate-limited me.

What it does:
- One OpenAI-compatible endpoint in front of 300+ models across OpenAI, Anthropic, Google, Mistral, Groq, OpenRouter, and more. Add a key, it discovers the catalog.
- Per-agent model choice + automatic failover. A coding agent can prefer a coding model and fall back to a free one when the paid key hits a 429.
- Real token compression pipeline (6 composable engines) that measures actual char/token savings — no invented percentages.
- Persistent memory (short/long-term vector store) + A2A agent-to-agent routing.
- Self-healing: anomaly detection → diagnosis → safe remediation, with guardrails (e.g. shell-exec is never auto-run).
- Free-tier aware: it knows which models are free and can aggregate documented provider quotas so you can prototype at $0.

It's local-first (connects directly to providers, no MITM/proxy interception), Apache-2.0, and runs as a single gateway process with a web dashboard (installable as PWA).

Honest gaps: full multi-agent *orchestration* primitives are next-release (the A2A wire protocol + message routing are in). And I'd rather you verify the free-tier numbers yourself — they're sourced with links in the code, not asserted as gospel.

Would love feedback from people running multi-provider agent stacks.

---

## r/LocalLLaMA

**Nexus: local-first AI gateway — 300+ models behind one endpoint, free-tier routing, real token compression**

[GitHub link]

I've been dogfooding Nexus as the routing layer for my agent setups. Key points that matter here:

- **One endpoint, many providers.** Point your OpenAI-compatible client at the gateway; it discovers and routes across OpenAI/Anthropic/Google/Mistral/Groq/OpenRouter/etc.
- **Free-tier first.** It tags free models and can route to them; the dashboard shows a sourced aggregate of documented free quotas (Gemini 1.5k req/day, Groq 30K TPM, Mistral ~1B tok/mo, OpenRouter 20 req/min — each linked to its source, verified 2026-08).
- **Token compression you can measure.** 6 stacked engines (minify, dedupe, array-collapse, middle-elide, session dedup, columnar headroom) report real savings per engine.
- **Self-healing + guardrails.** Detects degradation, verifies health, falls back — and never auto-runs shell commands.
- **Local-first / no lock-in.** Direct egress by default, SSRF-guarded, no MITM. Apache-2.0.

PWA dashboard, persistent memory, A2A routing included. Multi-agent *orchestration* is roadmap. AMA.

---

## dev.to (technical article)

Title: **Building a self-healing, free-tier-aware AI gateway (and why I refused to fake the numbers)**

Hook: Most "AI gateway" posts show a benchmark graph with suspiciously round savings. This one shows the code, the tests, and the source links instead.

Sections:
1. The problem: provider churn, rate limits, and $0 prototyping
2. Architecture: one OpenAI-compatible endpoint → router → provider adapters
3. Honest token compression: measuring, not claiming
4. Free-tier aggregation done right (with citations)
5. Self-healing without autonomous shell access
6. Local-first security posture
7. What's next (multi-agent orchestration)

CTA: try it — `git clone`, one env var per provider, open the dashboard.

---

## X / Twitter (thread)

1/ Shipping Nexus — a local-first AI gateway that puts 300+ models behind one OpenAI-compatible endpoint. No vendor lock-in, Apache-2.0. github.com/rachidSabah/Nexus

2/ The part I'm proudest of: it routes to FREE models automatically and shows you the sourced free-tier ceilings (Gemini 1.5k/day, Groq 30K TPM, Mistral ~1B/mo). Every number links to its provider doc. No invented stats.

3/ Token compression reports REAL per-engine savings across 6 stacked engines. If an external engine (e.g. Caveman) isn't wired, it says so — never fakes a percentage.

4/ Self-heals: anomaly → diagnose → safe remediation, with guardrails that block autonomous shell exec. Local-first: direct egress, SSRF-guarded, no MITM.

5/ Includes persistent memory, A2A agent routing, and an installable PWA dashboard. Multi-agent orchestration is next. Star + try it: github.com/rachidSabah/Nexus

---

## GitHub repo metadata (set via web UI or `gh` once authenticated)

- Description: "Local-first AI gateway + multi-agent orchestrator. One endpoint for 300+ models, free-tier routing, real token compression, self-healing reliability."
- Topics: ai-gateway, llm, multi-agent, openai-compatible, free-tier, token-compression, model-routing, self-healing, local-first, typescript
- Homepage: https://github.com/rachidSabah/Nexus
