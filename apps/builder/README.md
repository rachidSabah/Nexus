# @anx/builder

**Agent Nexus Universal Build & Pipeline Execution Engine**  
Architected using **Hexagonal / Clean Architecture (Ports & Adapters)** in **Node.js** and **TypeScript**.

---

## 🏛️ Architecture Overview

The builder application strictly follows Clean / Hexagonal Architecture principles, separating domain logic from infrastructure details and delivery mechanisms:

```
apps/builder/
├── src/
│   ├── config/                      # Configuration Component
│   │   ├── env.schema.ts            # Zod environment variable schema
│   │   └── config.ts                # Strongly-typed AppConfig singleton
│   │
│   ├── domain/                      # Domain Core (Enterprise & Application Domain)
│   │   ├── models/                  # Rich Domain Entities & Value Objects
│   │   │   ├── project.ts           # Project aggregate root
│   │   │   ├── build-job.ts         # BuildJob aggregate root & state machine
│   │   │   ├── step.ts              # PipelineStep execution entity
│   │   │   ├── artifact.ts          # Build Artifact model & metadata
│   │   │   ├── template.ts          # BuildTemplate specifications
│   │   │   └── types.ts             # Statuses, Frameworks, Metrics
│   │   ├── errors/                  # Explicit Domain & NotFound Errors
│   │   ├── events/                  # Domain Events (build.created, build.completed, etc.)
│   │   └── ports/                   # Inbound (Driving) & Outbound (Driven) Ports
│   │       ├── inbound/             # Use case interfaces
│   │       └── outbound/            # Repository, Storage, Execution, Publisher ports
│   │
│   ├── application/                 # Application Use Cases
│   │   ├── use-cases/               # Isolated single-responsibility use cases
│   │   │   ├── create-project.use-case.ts
│   │   │   ├── get-project.use-case.ts
│   │   │   ├── list-projects.use-case.ts
│   │   │   ├── delete-project.use-case.ts
│   │   │   ├── trigger-build.use-case.ts
│   │   │   ├── get-build.use-case.ts
│   │   │   ├── list-builds.use-case.ts
│   │   │   ├── cancel-build.use-case.ts
│   │   │   ├── get-build-logs.use-case.ts
│   │   │   ├── list-artifacts.use-case.ts
│   │   │   ├── download-artifact.use-case.ts
│   │   │   └── template-catalog.use-case.ts
│   │
│   ├── infrastructure/              # Driven Adapters (Outbound Implementations)
│   │   ├── persistence/             # In-memory & JSON file-backed repositories
│   │   ├── storage/                 # Local filesystem SHA-256 artifact storage
│   │   ├── execution/               # Multi-platform process runner & timeout manager
│   │   ├── events/                  # EventEmitter domain event publisher
│   │   └── templates/               # Pre-configured templates (Node, Next.js, Rust, etc.)
│   │
│   ├── api/                         # API Layer (Driving Adapters - Fastify)
│   │   ├── controllers/             # HTTP Controllers
│   │   ├── routes/                  # REST route registrations
│   │   ├── dtos/                    # Request/Response schemas with Zod validation
│   │   └── middlewares/             # Global error handler & formatting
│   │
│   ├── server.ts                    # Fastify Server factory & Dependency Injection container
│   └── index.ts                     # Application entrypoint
│
└── tests/                           # Vitest Unit & Integration Suites
    ├── domain/
    ├── application/
    ├── infrastructure/
    └── api/
```

---

## 🚀 API Endpoints

### 🩺 Health & Metrics
- `GET /health` - Service health status, uptime, version
- `GET /metrics` - Active builds, total counts, Node.js memory footprint

### 📁 Projects
- `POST /api/v1/projects` - Register a new build project
- `GET /api/v1/projects` - List all registered projects
- `GET /api/v1/projects/:id` - Fetch project details
- `DELETE /api/v1/projects/:id` - Delete a project

### ⚙️ Builds & Execution
- `POST /api/v1/builds` - Trigger a build pipeline (custom steps or template-based)
- `GET /api/v1/builds` - List builds with filters (`projectId`, `status`, pagination)
- `GET /api/v1/builds/:id` - Get status, step breakdown, execution metrics
- `POST /api/v1/builds/:id/cancel` - Cancel queued/running build
- `GET /api/v1/builds/:id/logs` - Fetch timestamped build logs

### 📦 Artifacts
- `GET /api/v1/builds/:buildId/artifacts` - List artifacts produced by build
- `GET /api/v1/artifacts/:id/download` - Stream artifact binary download

### 📋 Templates
- `GET /api/v1/templates` - Catalog of pre-configured build templates (Node, Next.js, React, Python, Rust)
- `GET /api/v1/templates/:id` - Template details and default step pipeline

---

## 🛠️ Testing & Building

```bash
# Run unit & integration tests
pnpm --filter @anx/builder test

# Type check
pnpm --filter @anx/builder typecheck

# Build bundle
pnpm --filter @anx/builder build
```
