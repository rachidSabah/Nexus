# Roadmap

Nexus is a local-first universal AI coding-agent gateway and autonomous control
plane. The roadmap below reflects intended direction; items are not commitments.

## Near term
- **Public 1.0**: stabilize the open-source release, expand provider adapters,
  and polish the first-run experience.
- **Provider breadth**: first-class adapters for additional OpenAI/Anthropic-
  compatible and self-hosted endpoints.
- **Agent coverage**: deeper live-verification flows for Gemini CLI, Qwen Code,
  Kimi Code, Aider, Cline, and Roo Code.
- **Observability**: richer dashboards for routing decisions, latency, and cost.

## Mid term
- **Policy editor**: visual routing-policy authoring in the dashboard.
- **Cost guardrails**: per-key and per-namespace spend limits and alerts.
- **Workspace isolation**: stronger multi-tenant boundaries for shared deployments.
- **Plugin marketplace**: vetted, signed plugins and agents.

## Long term
- **Federated gateways**: multi-node Nexus deployments with shared catalog sync.
- **Autonomous application building**: expanded planner/risk/workflow
  orchestration for Hermes/OpenCode builders.
- **On-device models**: local inference endpoints as first-class providers.

## Non-goals
- Nexus is **not** a coding agent itself — it is the control plane that routes
  agents to models. Building-agent logic (Hermes, OpenCode) lives outside the
  gateway core.
- Nexus does **not** require public proxy scraping to function; it operates in
  `DIRECT` mode against provider APIs.
