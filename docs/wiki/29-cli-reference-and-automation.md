# 29 — CLI Reference & Automation

[← Previous: Service Mesh & Traffic Shaping](28-service-mesh-and-traffic-shaping.md) | [Index](01-introduction-and-overview.md) | [Next: Configuration & Environment Variables →](30-configuration-and-environment-variables.md)

---

## Nexus CLI (`anx`)

The `anx` CLI tool (`packages/cli/`) provides direct developer terminal controls for local operations:

### Core Commands

| Command | Arguments | Description |
|---|---|---|
| `anx start` | `[--port 8787] [--host 127.0.0.1]` | Starts the local Nexus AI gateway server |
| `anx status` | | Checks health and status of the local gateway |
| `anx models` | `[--free] [--capability <cap>]` | Lists discovered models and virtual aliases |
| `anx keys add` | `<provider> <key> [--label <label>]` | Adds and encrypts a provider API key |
| `anx missions create` | `<objective>` | Dispatches an autonomous agent mission |
| `anx backup` | `[--out <path>]` | Generates a verified system backup snapshot |
| `anx restore` | `<file>` | Restores state from a backup bundle |

---

[← Previous: Service Mesh & Traffic Shaping](28-service-mesh-and-traffic-shaping.md) | [Index](01-introduction-and-overview.md) | [Next: Configuration & Environment Variables →](30-configuration-and-environment-variables.md)
