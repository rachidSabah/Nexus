/**
 * AutonomousPlanner — Phase 11 extended
 *
 * Generates a WorkflowDefinition with AGY-specific node types:
 *   AGY_SCAFFOLD → AGY_IMPLEMENT → AGY_TEST → [APPROVAL if high-risk] → AGY_VERIFY
 *
 * Nexus retains full responsibility for:
 *   - risk classification
 *   - approval gate injection
 *   - node configuration (model, policy, timeout, etc.)
 * AGY builds; Nexus plans.
 */
import { type WorkflowDefinition, type WorkflowNode, type WorkflowEdge } from '../domain/workflow.js';

import { DAGEngine } from './dag-engine.js';
import { RiskEngine, type RiskAnalysis } from './risk-engine.js';
import { TaskClassifier } from './task-classifier.js';

export interface AutonomousPlanResult {
  readonly definition: WorkflowDefinition;
  readonly category: string;
  readonly risk: RiskAnalysis;
  readonly estimatedCostUsd: number;
}

export class AutonomousPlanner {
  private readonly classifier = new TaskClassifier();
  private readonly riskEngine = new RiskEngine();
  private readonly dagEngine = new DAGEngine();

  plan(prompt: string): AutonomousPlanResult {
    const classification = this.classifier.classify({
      messages: [{ role: 'user', content: prompt }],
      model: 'default',
    });
    const risk = this.riskEngine.analyze(prompt);

    // ── AGY-specific node graph ──────────────────────────────────────────────

    const nodes: WorkflowNode[] = [
      {
        id: 'scaffold',
        type: 'AGENT',
        name: 'AGY: Scaffold Project',
        config: {
          agentType: 'agy',
          kind: 'AGY_SCAFFOLD',
          prompt: `Scaffold project for: ${prompt}`,
          policy: 'nexus/best-coding',
        },
        status: 'PENDING',
      },
      {
        id: 'implement',
        type: 'AGENT',
        name: 'AGY: Implement Application',
        config: {
          agentType: 'agy',
          kind: 'AGY_IMPLEMENT',
          prompt: `Implement application for: ${prompt}`,
          policy: 'nexus/best-coding',
        },
        status: 'PENDING',
      },
      {
        id: 'test',
        type: 'AGENT',
        name: 'AGY: Run Tests',
        config: {
          agentType: 'agy',
          kind: 'AGY_TEST',
          prompt: 'Run test suite',
          policy: 'nexus/fast',
        },
        status: 'PENDING',
      },
      {
        id: 'verify',
        type: 'AGENT',
        name: 'AGY: Verify Artifacts',
        config: {
          agentType: 'agy',
          kind: 'AGY_VERIFY',
          prompt: 'Verify application artifacts',
          policy: 'nexus/fast',
        },
        status: 'PENDING',
      },
    ];

    const edges: WorkflowEdge[] = [
      { fromNodeId: 'scaffold', toNodeId: 'implement' },
      { fromNodeId: 'implement', toNodeId: 'test' },
      { fromNodeId: 'test', toNodeId: 'verify' },
    ];

    // ── High-risk approval gate ───────────────────────────────────────────────
    if (risk.requiresApproval) {
      nodes.push({
        id: 'approval_gate',
        type: 'APPROVAL',
        name: `Risk Approval Gate (${risk.level})`,
        config: {
          riskLevel: risk.level,
          flags: risk.flags,
          requiredPermission: 'applications:approve',
          message: `This application build has been classified as ${risk.level} risk. Flags: ${risk.flags.join(', ')}. Manual approval required before AGY execution.`,
        },
        status: 'PENDING',
      });
      // Insert approval gate before scaffold
      edges.length = 0;
      edges.push(
        { fromNodeId: 'approval_gate', toNodeId: 'scaffold' },
        { fromNodeId: 'scaffold', toNodeId: 'implement' },
        { fromNodeId: 'implement', toNodeId: 'test' },
        { fromNodeId: 'test', toNodeId: 'verify' },
      );
      // Put approval gate first in nodes array
      const approvalNode = nodes.pop()!;
      nodes.unshift(approvalNode);
    }

    const definition: WorkflowDefinition = {
      id: `auto-wf-${Date.now()}`,
      name: `AGY Application Build — ${classification.type}`,
      description: prompt,
      version: '11.0',
      nodes,
      edges,
      variables: {
        riskLevel: risk.level,
        riskScore: risk.score,
        category: classification.type,
        requiresApproval: risk.requiresApproval,
      },
    };

    const val = this.dagEngine.validate(definition);
    if (!val.valid) {
      throw new Error(`Generated invalid workflow DAG: ${val.errors.join(', ')}`);
    }

    return {
      definition,
      category: classification.type,
      risk,
      estimatedCostUsd: this.estimateCost(classification.type),
    };
  }

  private estimateCost(category: string): number {
    // Rough estimates based on typical AGY execution costs through Nexus
    switch (category) {
      case 'CODING': return 0.35;
      case 'ARCHITECTURE': return 0.50;
      case 'DEBUGGING': return 0.20;
      case 'TESTING': return 0.15;
      default: return 0.25;
    }
  }
}
