import { describe, it, expect } from 'vitest';
import { DAGEngine } from '../src/application/dag-engine.js';
import { type WorkflowDefinition } from '../src/domain/workflow.js';

describe('DAGEngine', () => {
  it('validates a valid DAG and produces topological order', () => {
    const dag = new DAGEngine();
    const def: WorkflowDefinition = {
      id: 'wf-test',
      name: 'Test Workflow',
      description: 'Testing DAG validation',
      version: '1.0',
      nodes: [
        { id: 'nodeA', type: 'TASK', name: 'Step A', config: {}, status: 'PENDING' },
        { id: 'nodeB', type: 'TASK', name: 'Step B', config: {}, status: 'PENDING' },
      ],
      edges: [{ fromNodeId: 'nodeA', toNodeId: 'nodeB' }],
    };

    const res = dag.validate(def);
    expect(res.valid).toBe(true);
    expect(res.executionOrder).toEqual(['nodeA', 'nodeB']);
  });

  it('detects cycles in workflow DAG', () => {
    const dag = new DAGEngine();
    const def: WorkflowDefinition = {
      id: 'wf-cycle',
      name: 'Cycle Workflow',
      description: 'Testing cycle detection',
      version: '1.0',
      nodes: [
        { id: 'nodeA', type: 'TASK', name: 'Step A', config: {}, status: 'PENDING' },
        { id: 'nodeB', type: 'TASK', name: 'Step B', config: {}, status: 'PENDING' },
      ],
      edges: [
        { fromNodeId: 'nodeA', toNodeId: 'nodeB' },
        { fromNodeId: 'nodeB', toNodeId: 'nodeA' },
      ],
    };

    const res = dag.validate(def);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('Cycle detected');
  });
});
