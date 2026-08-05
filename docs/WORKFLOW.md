# Workflow Guide

This guide explains how to define, execute, and replay multi-agent workflows in Agent Nexus OS.

## What is a workflow?

A workflow is a **named, versioned sequence of steps**. Each step is executed by a specific agent (or by an auto-selected agent matching the step's capability). Step outputs are passed as context to subsequent steps.

Workflows are the orchestration layer that turns multiple agents into a coordinated pipeline.

## Defining a workflow

### Via the API

```bash
curl -X POST http://localhost:8787/v1/workflows \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "my-pipeline",
    "name": "My Pipeline",
    "description": "Build → Review → Test",
    "steps": [
      {
        "name": "build",
        "agent": "deepseek-coder",
        "model": "deepseek-coder",
        "task": "Implement: ${inputs.feature}",
        "systemPrompt": "You are a backend engineer.",
        "maxTokens": 4000
      },
      {
        "name": "review",
        "agent": "claude-code",
        "model": "claude-3-5-sonnet",
        "task": "Review this implementation:\\n\\n${build}",
        "inputs": ["build"],
        "systemPrompt": "You are a code reviewer."
      },
      {
        "name": "test",
        "agent": "codex-cli",
        "model": "gpt-4o",
        "task": "Write tests for:\\n\\n${build}",
        "inputs": ["build"]
      }
    ],
    "inputs": [
      { "name": "feature", "description": "The feature to build", "required": true }
    ],
    "outputs": [
      { "name": "implementation", "fromStep": "build" },
      { "name": "review", "fromStep": "review" },
      { "name": "tests", "fromStep": "test" }
    ],
    "tags": ["software", "pipeline"]
  }'
```

### Via code

```ts
import { WorkflowEngine, InMemoryWorkflowRepository } from '@anx/workflow';

const engine = new WorkflowEngine(new InMemoryWorkflowRepository(), runtime, eventBus);
const def = await engine.create({
  id: 'my-pipeline',
  name: 'My Pipeline',
  description: 'Build → Review → Test',
  steps: [/* ... */],
  inputs: [/* ... */],
  outputs: [/* ... */],
});
```

### Built-in templates

Three templates ship with the package:

| Template | Steps | Use case |
|---|---|---|
| `software-development-pipeline` | architecture → implement → review → test → document | Full feature delivery |
| `bug-triage` | reproduce → diagnose → fix → verify | Bug fixing |
| `code-review` | security + performance + style (parallel) → consensus | Multi-perspective review |

Register them:
```ts
import { WORKFLOW_TEMPLATES } from '@anx/workflow';
for (const template of Object.values(WORKFLOW_TEMPLATES)) {
  await engine.create(template);
}
```

## Versioning

Workflows are immutable. Calling `engine.create({ id: 'my-pipeline', ... })` on an existing workflow **creates a new version** (auto-incremented).

```ts
const v1 = await engine.create({ id: 'wf', name: 'V1', description: '', steps: [...] });
const v2 = await engine.create({ id: 'wf', name: 'V2', description: '', steps: [...] });
console.log(v1.version, v2.version); // 1, 2
```

Get a specific version:
```ts
const v1 = await engine.get('wf', 1);
```

List all versions:
```ts
const versions = await engine.listVersions('wf');
```

## Executing a workflow

### Via the API

```bash
# Start an execution
curl -X POST http://localhost:8787/v1/workflows/my-pipeline/execute \
  -H 'Content-Type: application/json' \
  -d '{ "inputs": { "feature": "User authentication with OAuth2" } }'
# → { "executionId": "abc-123" }

# Poll status
curl http://localhost:8787/v1/workflows/my-pipeline/executions/abc-123
```

### Via code

```ts
const executionId = await engine.start('my-pipeline', {
  feature: 'User authentication with OAuth2',
});

// Poll (or subscribe to workflow.* events)
const exec = await engine.getExecution(executionId);
console.log(exec.status); // 'running' | 'completed' | 'failed' | 'paused' | 'cancelled'
console.log(exec.steps);  // each step's status + result
```

## Step inputs and interpolation

Each step can reference outputs of previous steps via `${stepName}` in its `task` field:

```json
{
  "name": "review",
  "task": "Review this code:\n\n${build}",
  "inputs": ["build"]
}
```

The engine interpolates `${build}` with the output of the `build` step before sending it to the agent.

You can also reference workflow inputs with `${inputs.featureName}`.

## Conditions

Steps can have a `condition` — a JS expression evaluated against the workflow context. If falsy, the step is skipped:

```json
{
  "name": "deploy",
  "task": "Deploy to production",
  "condition": "context.review && context.review.includes('approved')"
}
```

## Pause / Resume / Cancel

```bash
curl -X POST http://localhost:8787/v1/workflows/my-pipeline/executions/abc-123/pause
curl -X POST http://localhost:8787/v1/workflows/my-pipeline/executions/abc-123/resume
curl -X POST http://localhost:8787/v1/workflows/my-pipeline/executions/abc-123/cancel
```

Pause takes effect at the next step boundary. Resume continues from where it paused.

## Replay

Replay an execution with the same inputs:

```bash
curl -X POST http://localhost:8787/v1/workflows/my-pipeline/executions/abc-123/replay
# → { "executionId": "def-456" }
```

Useful for:
- Re-running after fixing a bug in a workflow definition
- A/B comparing different agent configurations
- Re-running with updated models

## Execution history

```bash
curl http://localhost:8787/v1/workflows/my-pipeline/executions?limit=20
```

Each execution record includes:
- `status` — running / paused / completed / failed / cancelled
- `steps` — per-step status, agent, start/end time, result
- `context` — interpolated context (outputs of each step)
- `totalCostUsd` — sum of all step costs
- `totalTokensUsed` — sum of all step tokens
- `outputs` — final outputs (mapped from steps via `def.outputs`)

## Events

| Event | When |
|---|---|
| `workflow.started` | Execution begins |
| `workflow.step.started` | A step begins |
| `workflow.step.completed` | A step finishes (success or failure) |
| `workflow.paused` | Execution paused |
| `workflow.resumed` | Execution resumed |
| `workflow.completed` | Execution completes |

Subscribe via WebSocket at `/ws` to get real-time updates in the dashboard.

## Visual builder

The dashboard includes a visual workflow builder at `/workflows`. It shows:
- The list of workflow definitions (left panel)
- A visual flow diagram of the selected workflow's steps
- Recent executions with per-step status bars (green=completed, amber=running, red=failed)
- Pause / Resume / Cancel / Replay buttons

The drag-and-drop step editor is on the roadmap (planned for v0.5).

## Best practices

1. **Use explicit agent ids** in steps (`agent: 'claude-code'`) rather than `capability: 'coding'`. This makes workflows deterministic and reproducible.

2. **Keep steps focused.** Each step should do one thing. If a step's prompt grows beyond ~500 tokens, consider splitting it.

3. **Chain outputs explicitly.** Use `inputs: ['stepName']` and `${stepName}` references. Don't rely on implicit context.

4. **Set per-step timeouts.** Long-running steps (like full implementations) should have `timeoutMs: 120000` or higher. Quick steps (like review) can use `timeoutMs: 30000`.

5. **Version your workflows.** Don't modify a workflow in place — create a new version. This preserves execution history's reproducibility.

6. **Test with `maxRetries: 0`** first. Once the workflow is stable, increase retries for resilience.

7. **Use the `condition` field** for conditional steps (e.g. only deploy if review approved).

8. **Tag your workflows.** Tags make it easier to find related workflows in the dashboard.
