# 27 — Agent Teams & Collaboration

[← Previous: Tool Runtime & MCP Integration](26-tool-runtime-and-mcp-integration.md) | [Index](01-introduction-and-overview.md) | [Next: Service Mesh & Traffic Shaping →](28-service-mesh-and-traffic-shaping.md)

---

## Agent-to-Agent (A2A) Protocols

Nexus includes the **A2A Coordination Engine** (`@anx/a2a`) enabling autonomous agent collaboration:

- **Team Formation**: Form specialized teams of heterogeneous agents (e.g. Lead Architect, Implementer, QA Reviewer).
- **Proposals & Voting**: Weighted consensus voting for critical architectural decisions.
- **Shared Working Memory**: Synchronized state across multi-agent sessions.

---

## Team API

### Form a Team
```http
POST /v1/teams
Content-Type: application/json

{
  "name": "Full-Stack Core Team",
  "description": "Cross-functional agent team for end-to-end development",
  "members": [
    { "agentId": "claude-code", "role": "Architect", "votingPower": 3 },
    { "agentId": "hermes", "role": "Backend", "votingPower": 2 },
    { "agentId": "opencode", "role": "QA Reviewer", "votingPower": 1 }
  ]
}
```

---

[← Previous: Tool Runtime & MCP Integration](26-tool-runtime-and-mcp-integration.md) | [Index](01-introduction-and-overview.md) | [Next: Service Mesh & Traffic Shaping →](28-service-mesh-and-traffic-shaping.md)
