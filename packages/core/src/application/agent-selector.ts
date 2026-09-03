import { type TaskCategory } from '../domain/orchestration.js';

export interface AgentCandidate {
  readonly id: string;
  readonly name: string;
  readonly runnable: boolean;
  readonly liveVerified: boolean;
  readonly found: boolean;
}

export interface AgentSelectionResult {
  readonly selectedAgent: string;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly alternatives: readonly { readonly agentId: string; readonly score: number }[];
}

export class AgentSelector {
  selectAgent(
    candidates: readonly AgentCandidate[],
    req: { category: TaskCategory; preferredAgent?: string }
  ): AgentSelectionResult {
    if (req.preferredAgent) {
      const match = candidates.find(c => c.id === req.preferredAgent);
      if (match && match.runnable) {
        return {
          selectedAgent: match.id,
          score: 1.0,
          reasons: ['Explicit user preferred agent requested and runnable'],
          alternatives: [],
        };
      }
    }

    const scored = candidates.map(c => {
      let score = 0;
      const reasons: string[] = [];

      if (c.runnable) {
        score += 0.5;
        reasons.push('Agent is installed and runnable');
      }

      if (c.liveVerified) {
        score += 0.3;
        reasons.push('Agent execution has been live verified');
      }

      if (req.category === 'CODING' || req.category === 'DEBUGGING') {
        if (c.id === 'codex-cli' || c.id === 'claude-code' || c.id === 'hermes-cli' || c.id === 'agy') {
          score += 0.2;
          reasons.push('High suitability for code generation and debugging');
        }
      } else {
        score += 0.1;
      }

      return { agentId: c.id, score: Number(score.toFixed(2)), reasons };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0] ?? { agentId: 'claude-code', score: 0.5, reasons: ['Default fallback agent'] };

    return {
      selectedAgent: best.agentId,
      score: best.score,
      reasons: best.reasons,
      alternatives: scored.slice(1).map(s => ({ agentId: s.agentId, score: s.score })),
    };
  }
}
