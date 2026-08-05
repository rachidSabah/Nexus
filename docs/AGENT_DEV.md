# Agent Development Guide

This guide explains how to build, register, and operate AI agents in Agent Nexus OS.

## What is an agent?

An agent is an AI entity that:
- Has a stable identity (`id`)
- Declares capabilities (e.g. `coding`, `architecture`, `review`)
- Declares tools it can use (e.g. `filesystem`, `terminal`, `git`)
- Declares models it can run on
- Has permissions (allow / deny list)
- Has a status (`online`, `offline`, `busy`)
- Can be assigned tasks by the runtime or workflows

Agents are NOT models. An agent uses models to do its work. Multiple agents can share the same model; the same agent can use different models for different tasks.

## Registering an agent

### Via the API

```bash
curl -X POST http://localhost:8787/v1/agents \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-coder",
    "name": "My Custom Coder",
    "description": "A custom coding agent",
    "capabilities": ["coding", "debugging"],
    "tools": ["filesystem", "terminal"],
    "models": ["gpt-4o", "claude-3-5-sonnet"],
    "permissions": ["filesystem.read", "filesystem.write", "terminal.execute"],
    "tags": ["custom", "coding"],
    "concurrencyLimit": 4,
    "costMultiplier": 1.0
  }'
```

### Via code

```ts
import { AgentRegistry } from '@anx/agents';

const registry = new AgentRegistry(eventBus);
await registry.register({
  id: 'my-coder',
  name: 'My Custom Coder',
  description: 'A custom coding agent',
  capabilities: ['coding', 'debugging'],
  tools: ['filesystem', 'terminal'],
  models: ['gpt-4o', 'claude-3-5-sonnet'],
  permissions: ['filesystem.read', 'filesystem.write', 'terminal.execute'],
  tags: ['custom', 'coding'],
  concurrencyLimit: 4,
  costMultiplier: 1.0,
});
```

### Built-in agents

10 built-in agent templates ship with the package:

| ID | Capabilities | Best at |
|---|---|---|
| `claude-code` | coding, architecture, review, planning, debugging, documentation | architecture, review |
| `codex-cli` | coding, testing, implementation, refactoring | implementation, tests |
| `gemini-cli` | coding, frontend, vision, documentation, multimodal | frontend, large context |
| `hermes-cli` | reasoning, coding, planning, tool-use | reasoning |
| `opencode` | coding, tool-use, debugging | MCP tool use |
| `openhands` | coding, architecture, testing, deployment, autonomous | end-to-end features |
| `aider` | coding, refactoring, editing | surgical edits |
| `continue` | coding, autocomplete, chat | editor autocomplete |
| `mistral-coder` | coding, documentation, testing | cost-effective docs |
| `deepseek-coder` | coding, backend, debugging, implementation | backend, low cost |

Register all built-in templates:
```ts
import { registerBuiltinAgents } from '@anx/agents';
const count = await registerBuiltinAgents(registry);
```

## Sending a task to an agent

### Via the API

```bash
curl -X POST http://localhost:8787/v1/agents/claude-code/tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Review this code for bugs"}],
    "systemPrompt": "You are a code reviewer."
  }'
```

### Via code

```ts
import { AgentRuntime, generateTaskId } from '@anx/runtime';

const runtime = new AgentRuntime(registry, executor, eventBus);
const result = await runtime.executeTask({
  id: generateTaskId(),
  agentId: 'claude-code',
  model: 'claude-3-5-sonnet',
  messages: [{ role: 'user', content: 'Review this code' }],
  systemPrompt: 'You are a code reviewer.',
  timeoutMs: 60_000,
  maxRetries: 2,
});

if (result.success) {
  console.log(result.response.choices[0].message.content);
  console.log(`Used ${result.tokensUsed} tokens, cost $${result.costUsd}`);
} else {
  console.error(result.error);
}
```

## Capabilities

Capabilities are free-form strings. Recommended vocabulary:

| Capability | Used for |
|---|---|
| `coding` | General coding tasks |
| `architecture` | System design, planning |
| `frontend` | UI work |
| `backend` | API / server work |
| `testing` | Writing tests |
| `documentation` | Writing docs |
| `review` | Code review |
| `debugging` | Finding and fixing bugs |
| `refactoring` | Restructuring code |
| `deployment` | CI/CD, Docker, K8s |
| `reasoning` | Multi-step reasoning |
| `tool-use` | Agentic tool use |
| `autonomous` | End-to-end autonomous work |
| `vision` | Image understanding |
| `multimodal` | Multi-modal input |

## Permissions

Permissions control which tools an agent can use. They follow a `category.action` format:

```ts
permissions: [
  'filesystem.read',       // can read files
  'filesystem.write',      // can write files
  'terminal.execute',      // can run shell commands
  'git.*',                 // all git operations
  // 'production.deploy'   // NOT in the list — denied by default
]
```

The `ToolRuntime.checkPermission()` method uses wildcard matching: `filesystem.*` matches `filesystem.read`, `filesystem.write`, etc.

## Health monitoring

Each agent can register a health probe:

```ts
registry.setProbe('my-agent', async (agentId) => {
  const r = await fetch(`http://localhost:3000/agents/${agentId}/health`);
  return r.ok;
});
```

Agents that miss heartbeats (default 60s) are automatically marked `offline` by `registry.sweepStale()`.

## Cost tracking

Each agent has a `costMultiplier` (default 1.0). The runtime multiplies the base model cost by this factor:

- `1.0` — pass-through (no markup)
- `0.5` — half cost (e.g. a cheap local agent)
- `2.0` — double cost (e.g. a premium managed agent)

Costs are tracked per-session and per-agent. Aggregate metrics are exposed at `/metrics`.

## Discovery

```ts
// Find agents by capability
const coders = registry.findByCapability('coding');

// Find agents that can use a specific model
const gpt4Agents = registry.findByModel('gpt-4');

// Find agents by tag
const frontendAgents = registry.findByTag('frontend');

// Complex eligibility query
const eligible = registry.findEligible({
  capabilities: ['coding', 'review'],
  deniedPermissions: ['production.deploy'],
});
```

## The Task Router

The `@anx/task-router` package automatically picks the best agent + model for a given request:

```ts
import { createPlanner } from '@anx/task-router';

const planner = createPlanner(registry);
const plan = planner.plan('Build a SaaS application for project management');

// plan.steps = [
//   { taskType: 'architecture', agentId: 'claude-code', model: 'claude-3-5-sonnet', ... },
//   { taskType: 'backend',      agentId: 'deepseek-coder', model: 'deepseek-coder', ... },
//   { taskType: 'frontend',     agentId: 'gemini-cli', model: 'gemini-1.5-pro', ... },
//   { taskType: 'testing',      agentId: 'codex-cli', model: 'gpt-4o', ... },
//   { taskType: 'documentation', agentId: 'mistral-coder', model: 'mistral-large', ... },
// ]
```

The planner uses 5 components:
1. **TaskClassifier** — keyword-based classification into 12 task types
2. **CapabilityMatcher** — maps task types → required capabilities
3. **AgentSelector** — scores eligible agents (tags, status, concurrency, cost)
4. **ModelSelector** — picks the best model per task type per agent
5. **ExecutionPlanner** — assembles single-step or multi-step plans

## Multi-agent collaboration

Agents can form teams, vote on proposals, and share workspaces. See the [Teams](./API.md#teams) API and the `@anx/a2a` package.

## Lifecycle events

| Event | When |
|---|---|
| `agent.created` | New agent registered |
| `agent.started` | Task assigned to agent |
| `agent.completed` | Task finished (success or failure) |
| `agent.failed` | Task failed |
| `agent.status.changed` | Agent moved online ↔ offline ↔ busy |

All events flow through the EventBus and are observable via WebSocket at `/ws`.
