/**
 * Built-in workflow definitions seeded into the WorkflowOrchestrator at boot.
 *
 * NOTE: the dashboard's "Registered Workflow Definitions" list is backed by
 * `WorkflowOrchestrator`, which uses the NODE-based `WorkflowDefinition`
 * schema (nodes + edges + DAG), NOT the step-based `WORKFLOW_TEMPLATES`
 * (steps/inputs/outputs) that feed the separate `WorkflowEngine`. These two
 * schemas are intentionally distinct. Add new built-ins here so they appear
 * in the dashboard on every gateway start and survive restarts.
 */

import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from '../domain/workflow.js';

function node(
  id: string,
  name: string,
  prompt: string,
  extra: Record<string, unknown> = {},
): WorkflowNode {
  return {
    id,
    type: 'AGENT',
    name,
    config: { prompt, ...extra },
    status: 'PENDING',
  };
}

function linearEdges(ids: string[]): WorkflowEdge[] {
  const edges: WorkflowEdge[] = [];
  for (let i = 0; i < ids.length - 1; i++) {
    const from = ids[i];
    const to = ids[i + 1];
    if (from === undefined || to === undefined) continue;
    edges.push({ fromNodeId: from, toNodeId: to });
  }
  return edges;
}

// ── Software Development Pipeline ──────────────────────────────────────────
const sdpNodes: WorkflowNode[] = [
  node('architecture', 'Architecture', 'Design the architecture for: ${inputs.feature}. Consider scalability, security, and maintainability. Output a brief architecture doc.', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a senior software architect.' }),
  node('implement', 'Implement', 'Implement the feature based on this architecture:\n\n${architecture}\n\nFeature: ${inputs.feature}', { agent: 'deepseek-coder', model: 'deepseek-coder', systemPrompt: 'You are a backend engineer. Write clean, tested code.', inputs: ['architecture'] }),
  node('review', 'Review', 'Review this implementation for bugs, security issues, and style:\n\n${implement}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a code reviewer. Be thorough but constructive.', inputs: ['implement'] }),
  node('test', 'Test', 'Write unit tests for this implementation:\n\n${implement}', { agent: 'codex-cli', model: 'gpt-4o', systemPrompt: 'You are a test engineer. Cover edge cases.', inputs: ['implement'] }),
  node('document', 'Document', 'Write documentation for this feature:\n\nFeature: ${inputs.feature}\n\nImplementation:\n${implement}', { agent: 'mistral-coder', model: 'mistral-large', systemPrompt: 'You are a technical writer.', inputs: ['implement'] }),
];

// ── Bug Triage & Fix ───────────────────────────────────────────────────────
const bugNodes: WorkflowNode[] = [
  node('reproduce', 'Reproduce', 'Reproduce this bug and describe the steps:\n\nBug report: ${inputs.bugReport}', { agent: 'codex-cli', model: 'gpt-4o', systemPrompt: 'You are a QA engineer reproducing a reported bug.' }),
  node('diagnose', 'Diagnose', 'Diagnose the root cause based on reproduction:\n\n${reproduce}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a senior engineer diagnosing a bug.', inputs: ['reproduce'] }),
  node('fix', 'Fix', 'Write a fix based on this diagnosis:\n\n${diagnose}', { agent: 'deepseek-coder', model: 'deepseek-coder', systemPrompt: 'You are a backend engineer. Write a minimal, correct fix.', inputs: ['diagnose'] }),
  node('verify', 'Verify', 'Verify the fix resolves the bug. Write a regression test.\n\nFix:\n${fix}\n\nOriginal bug:\n${inputs.bugReport}', { agent: 'codex-cli', model: 'gpt-4o', systemPrompt: 'You are a test engineer verifying a bug fix.', inputs: ['fix'] }),
];

// ── Multi-Agent Code Review ─────────────────────────────────────────────────
const reviewNodes: WorkflowNode[] = [
  node('security', 'Security Review', 'Review this code for security vulnerabilities:\n\n${inputs.code}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a security expert. Look for OWASP Top 10 issues.' }),
  node('performance', 'Performance Review', 'Review this code for performance issues:\n\n${inputs.code}', { agent: 'deepseek-coder', model: 'deepseek-coder', systemPrompt: 'You are a performance engineer. Look for O(n²) loops, unnecessary allocations, N+1 queries.' }),
  node('style', 'Style Review', 'Review this code for style and readability:\n\n${inputs.code}', { agent: 'mistral-coder', model: 'mistral-large', systemPrompt: 'You are a code style reviewer. Focus on naming, comments, and structure.' }),
  node('consensus', 'Consensus', 'Synthesize these three reviews into a single actionable list:\n\nSecurity:\n${security}\n\nPerformance:\n${performance}\n\nStyle:\n${style}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a tech lead. Produce a single prioritized list of issues to fix.', inputs: ['security', 'performance', 'style'] }),
];

// ── PR Build & CI (new) ─────────────────────────────────────────────────────
const prbuildNodes: WorkflowNode[] = [
  node('build', 'Build', 'Run the project build for branch "${inputs.branch}" and report any compile/bundle errors with the exact commands to reproduce them.\n\nRepo: ${inputs.repo}\nBranch: ${inputs.branch}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a build engineer. Produce a concise build report: success or the failing command + error.' }),
  node('lint', 'Lint', 'Run the linter on branch "${inputs.branch}" and list every warning/error by file:line.\n\nBuild context:\n${build}', { agent: 'deepseek-coder', model: 'deepseek-coder', systemPrompt: 'You are a lint engineer. Report only actionable lint issues; ignore auto-fixable noise.', inputs: ['build'] }),
  node('test', 'Test', 'Run the test suite for branch "${inputs.branch}" and report pass/fail counts, the failing test names, and the first failure trace.\n\nBuild context:\n${build}\n\nLint context:\n${lint}', { agent: 'codex-cli', model: 'gpt-4o', systemPrompt: 'You are a test engineer. Report results clearly: how many passed/failed and what broke.', inputs: ['build', 'lint'] }),
  node('package', 'Package', 'Package the build artifacts for branch "${inputs.branch}" (e.g. docker build, npm pack, or wheel). Report the artifact name/location and any packaging warnings.\n\nBuild context:\n${build}\n\nTest context:\n${test}', { agent: 'mistral-coder', model: 'mistral-large', systemPrompt: 'You are a release engineer. Confirm the artifact is produced and note any warnings.', inputs: ['build', 'test'] }),
  node('openPr', 'Open PR', 'Open (or update) a pull request from branch "${inputs.branch}" into "${inputs.baseBranch}" and verify its CI status. Use the title "${inputs.prTitle}" and summarize the build/lint/test results.\n\nBuild:\n${build}\n\nLint:\n${lint}\n\nTest:\n${test}\n\nPackage:\n${package}', { agent: 'claude-code', model: 'claude-3-5-sonnet', systemPrompt: 'You are a release engineer. Open the PR, attach the CI summary, and confirm the PR URL + checks.', inputs: ['build', 'lint', 'test', 'package'] }),
];

export const BUILT_IN_WORKFLOWS: readonly WorkflowDefinition[] = [
  {
    id: 'software-development-pipeline',
    name: 'Software Development Pipeline',
    description: 'Architect → Implement → Review → Test → Document',
    version: '1',
    nodes: sdpNodes,
    edges: linearEdges(sdpNodes.map((n) => n.id)),
  },
  {
    id: 'bug-triage',
    name: 'Bug Triage & Fix',
    description: 'Reproduce → Diagnose → Fix → Verify',
    version: '1',
    nodes: bugNodes,
    edges: linearEdges(bugNodes.map((n) => n.id)),
  },
  {
    id: 'code-review',
    name: 'Multi-Agent Code Review',
    description: 'Security review + Performance review + Style review → Consensus',
    version: '1',
    nodes: reviewNodes,
    edges: linearEdges(reviewNodes.map((n) => n.id)),
  },
  {
    id: 'prbuild',
    name: 'PR Build & CI',
    description: 'Build → Lint → Test → Package → Open / verify a pull request',
    version: '1',
    nodes: prbuildNodes,
    edges: linearEdges(prbuildNodes.map((n) => n.id)),
    variables: {
      repo: { description: 'The repository to build (e.g. owner/name or local path)', required: true },
      branch: { description: 'The feature/working branch to build', required: true },
      baseBranch: { description: 'The base branch the PR targets (default main)', required: false },
      prTitle: { description: 'Title for the pull request', required: false },
    },
  },
];
