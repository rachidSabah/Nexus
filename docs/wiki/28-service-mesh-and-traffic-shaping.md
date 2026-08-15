# 28 — Service Mesh & Traffic Shaping

[← Previous: Agent Teams & Collaboration](27-agent-teams-and-collaboration.md) | [Index](01-introduction-and-overview.md) | [Next: CLI Reference & Automation →](29-cli-reference-and-automation.md)

---

## AI Traffic Management

The **AI Service Mesh** (`@agent-nexus/service-mesh`) coordinates traffic shaping across multiple gateway clusters or upstream providers:

- **Canary Deployments**: Route a percentage of traffic to a new model or provider (e.g. 10% to Claude 3.7).
- **Blue-Green Switching**: Instant zero-downtime cutover between model versions.
- **Circuit Breakers**: Automatically opens circuits and diverts traffic on sustained provider failures.

---

## Mesh Control API

### Enable Canary Routing
```http
POST /v1/mesh/canary
Content-Type: application/json

{
  "percentage": 15,
  "canaryTag": "claude-3-7-sonnet"
}
```

### Switch Blue/Green Version
```http
POST /v1/mesh/blue-green
Content-Type: application/json

{
  "version": "green"
}
```

---

[← Previous: Agent Teams & Collaboration](27-agent-teams-and-collaboration.md) | [Index](01-introduction-and-overview.md) | [Next: CLI Reference & Automation →](29-cli-reference-and-automation.md)
