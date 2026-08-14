import { describe, it, expect } from 'vitest';

import { BUILT_IN_WORKFLOWS } from '../src/index.js';
import { DAGEngine } from '../src/index.js';
import type { WorkflowDefinition } from '../src/index.js';

describe('BUILT_IN_WORKFLOWS', () => {
  it('includes the four expected definitions', () => {
    const ids = BUILT_IN_WORKFLOWS.map((w) => w.id);
    expect(ids).toContain('software-development-pipeline');
    expect(ids).toContain('bug-triage');
    expect(ids).toContain('code-review');
    expect(ids).toContain('prbuild');
    expect(ids).toHaveLength(4);
  });

  it('each definition validates as a DAG', () => {
    const de = new DAGEngine();
    for (const def of BUILT_IN_WORKFLOWS) {
      const res = de.validate(def as WorkflowDefinition);
      expect(res.valid, `${def.id} should be a valid DAG: ${res.errors.join(', ')}`).toBe(true);
    }
  });

  it('prbuild is a 5-node linear pipeline: build → lint → test → package → openPr', () => {
    const prbuild = BUILT_IN_WORKFLOWS.find((w) => w.id === 'prbuild');
    expect(prbuild).toBeDefined();
    const nodeIds = prbuild!.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(['build', 'lint', 'test', 'package', 'openPr']);
    // edges form a single chain
    expect(prbuild!.edges).toHaveLength(4);
    expect(prbuild!.edges[0]).toMatchObject({ fromNodeId: 'build', toNodeId: 'lint' });
    expect(prbuild!.edges[3]).toMatchObject({ fromNodeId: 'package', toNodeId: 'openPr' });
  });

  it('each node has a prompt in its config', () => {
    for (const def of BUILT_IN_WORKFLOWS) {
      for (const n of def.nodes) {
        expect((n.config as { prompt?: string }).prompt).toBeTypeOf('string');
        expect(((n.config as { prompt?: string }).prompt ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});
