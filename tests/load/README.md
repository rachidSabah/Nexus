# Load Testing Plan

Targets for v0.4.0:

- **100 concurrent workflows** — engine must enqueue and execute 100 workflows in parallel without deadlocks or unbounded memory growth.
- **50 agents** — registry must handle 50 registered agents with heartbeats and status changes.
- **500 WebSocket connections** — event bus must fan out events to 500 subscribers with < 100ms median latency.

## Running the load tests

```bash
# Install k6
brew install k6  # or: https://k6.io/docs/getting-started/installation/

# Run the workflow load test
k6 run tests/load/workflows.js

# Run the agent load test
k6 run tests/load/agents.js

# Run the websocket load test
k6 run tests/load/websockets.js
```

## Success criteria

| Test | Metric | Target |
|---|---|---|
| 100 concurrent workflows | p50 start latency | < 50ms |
| 100 concurrent workflows | p99 start latency | < 500ms |
| 100 concurrent workflows | memory growth | < 100MB over 5 min |
| 50 agents | heartbeat processing | < 10ms per heartbeat |
| 50 agents | findEligible() p99 | < 5ms |
| 500 WebSocket connections | event fan-out p50 | < 50ms |
| 500 WebSocket connections | event fan-out p99 | < 200ms |
| 500 WebSocket connections | sustained throughput | 10,000 events/sec |

## Profiling

```bash
# CPU profile
node --cpu-prof apps/gateway/dist/bin.js &

# Heap snapshot
node --heap-prof apps/gateway/dist/bin.js &

# Clinic.js
clinic doctor --on-port 'curl http://localhost:8787/health' -- node apps/gateway/dist/bin.js
```
