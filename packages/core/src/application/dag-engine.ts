import { type WorkflowDefinition } from '../domain/workflow.js';

export interface DAGValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly executionOrder?: readonly string[];
}

export class DAGEngine {
  validate(def: WorkflowDefinition): DAGValidationResult {
    const errors: string[] = [];
    const nodeIds = new Set(def.nodes.map(n => n.id));

    // 1. Unique Node IDs
    if (nodeIds.size !== def.nodes.length) {
      errors.push('Duplicate node IDs detected in workflow definition');
    }

    // 2. Edge References
    for (const edge of def.edges) {
      if (!nodeIds.has(edge.fromNodeId)) {
        errors.push(`Edge from unknown node ID '${edge.fromNodeId}'`);
      }
      if (!nodeIds.has(edge.toNodeId)) {
        errors.push(`Edge to unknown node ID '${edge.toNodeId}'`);
      }
    }

    // 3. Cycle Detection & Topological Sort
    const inDegree = new Map<string, number>();
    const graph = new Map<string, string[]>();

    for (const node of def.nodes) {
      inDegree.set(node.id, 0);
      graph.set(node.id, []);
    }

    for (const edge of def.edges) {
      if (graph.has(edge.fromNodeId) && inDegree.has(edge.toNodeId)) {
        graph.get(edge.fromNodeId)!.push(edge.toNodeId);
        inDegree.set(edge.toNodeId, (inDegree.get(edge.toNodeId) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);

      const neighbors = graph.get(current) ?? [];
      for (const neighbor of neighbors) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (order.length !== def.nodes.length) {
      errors.push('Cycle detected in workflow DAG dependency graph');
    }

    return {
      valid: errors.length === 0,
      errors,
      executionOrder: errors.length === 0 ? order : undefined,
    };
  }

  getReadyNodes(def: WorkflowDefinition, completedNodeIds: Set<string>): string[] {
    const ready: string[] = [];

    for (const node of def.nodes) {
      if (completedNodeIds.has(node.id)) continue;

      const incomingEdges = def.edges.filter(e => e.toNodeId === node.id);
      const dependenciesMet = incomingEdges.every(e => completedNodeIds.has(e.fromNodeId));

      if (dependenciesMet) {
        ready.push(node.id);
      }
    }

    return ready;
  }
}
