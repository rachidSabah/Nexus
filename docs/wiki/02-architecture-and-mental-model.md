# 02 — Architecture & Mental Model

[← Previous: Introduction & Overview](01-introduction-and-overview.md) | [Index](01-introduction-and-overview.md) | [Next: Quickstart & Installation →](03-quickstart-and-installation.md)

---

## Hexagonal Architecture & Clean Ports

Nexus is built strictly upon **Hexagonal (Ports and Adapters) Architecture**. The system is decoupled into three concentric layers:

1. **Domain Layer (`packages/core/src/domain/`)**: Pure value objects, entities, events, branded types, and error classifications. Zero external I/O dependencies.
2. **Application Layer (`packages/core/src/application/`)**: Use cases, domain orchestrators, routing engines, scoring heuristics, and abstract Port interfaces.
3. **Infrastructure Layer (`packages/persistence/`, `packages/providers/`, `apps/gateway/`)**: Concrete adapters for HTTP servers, SQLite engines, process bridges, and third-party APIs.

```mermaid
graph LR
    subgraph Core ["Core Domain & Use Cases (@anx/core)"]
        Domain["Domain Entities<br/>(Mission, Route, Key, Model)"]
        Ports["Abstract Ports<br/>(RoutingPort, StoragePort, AgentPort)"]
        UseCases["Application Engines<br/>(Scoring, Planning, Recovery)"]
    end
    
    subgraph Adapters ["Infrastructure Adapters"]
        HTTP["Fastify HTTP Server (@anx/gateway)"]
        SQLite["ACID SQLite Adapter (@anx/persistence)"]
        Providers["Provider Adapters (@anx/providers)"]
        Agents["Agent Subprocess Bridge (@anx/core)"]
    end
    
    HTTP --> Ports
    SQLite --> Ports
    Providers --> Ports
    Agents --> Ports
    UseCases --> Domain
```

---

## 14-Subsystem Health & Dependency Hierarchy

Nexus coordinates 14 distinct architectural subsystems. The health of the entire platform is aggregated deterministically by the `SystemHealthAggregator`.

```mermaid
graph TD
    GW[1. Gateway HTTP / SSE Ingress]
    ROUTING[2. Routing Engine]
    MODELS[3. Model Registry & Discovery]
    KEYS[4. Key Registry & Rotation]
    VAULT[5. Credential Vault]
    BRIDGE[6. Local Agent Bridge]
    AGENT_ORCH[7. Agent Orchestrator]
    MISSION_ORCH[8. Mission Orchestrator]
    PERSISTENCE[9. Durable Persistence Engine]
    RECOVERY[10. Crash Recovery Engine]
    OBSERVABILITY[11. Telemetry & Event Buffer]
    OPTIMIZER[12. Token & Cost Optimizer]
    MESH[13. Service Mesh & Traffic Shaping]
    SECURITY[14. Security & RBAC Guardrails]

    GW --> SECURITY
    GW --> ROUTING
    ROUTING --> MODELS
    ROUTING --> KEYS
    KEYS --> VAULT
    GW --> MISSION_ORCH
    MISSION_ORCH --> AGENT_ORCH
    AGENT_ORCH --> BRIDGE
    MISSION_ORCH --> PERSISTENCE
    GW --> RECOVERY
    RECOVERY --> PERSISTENCE
    GW --> OBSERVABILITY
    GW --> OPTIMIZER
    GW --> MESH
```

---

## The Request Lifecycle Mental Model

When a client or agent interacts with Nexus:

1. **Ingress & Security Context**: Fastify receives the request, sets correlation headers (`x-nexus-request-id`, `x-nexus-mission-id`, `x-nexus-task-id`, `x-nexus-execution-id`), checks authorization and tenant scope via `SecurityContext`.
2. **Intent Classification & Scoring**: `IntentDetector` inspects messages, tools, and constraints. `ScoringEngine` evaluates all available models across 5 weighted dimensions.
3. **Credential Selection**: `KeyRegistry` retrieves a healthy, active API key for the selected provider from the encrypted vault and applies rotation strategies.
4. **Resilient Execution & Failover**: The provider adapter transmits the payload. If a transient error, 429, or timeout occurs, `DefaultFailover` triggers dynamic failover to the next best scored alternative.
5. **Token Accounting & Telemetry**: Response tokens, cost, latency percentiles, and request traces are recorded in the ring buffer and broadcast via SSE (`/v1/system/events`).
6. **Durable State Commit**: For missions or workflow operations, intermediate DAG states and checkpoints are written to SQLite using atomic write boundaries.

---

[← Previous: Introduction & Overview](01-introduction-and-overview.md) | [Index](01-introduction-and-overview.md) | [Next: Quickstart & Installation →](03-quickstart-and-installation.md)
