import { describe, it, expect, beforeEach } from 'vitest';
import { RoutingStrategy, type StrategyCandidate } from '../src/application/routing-strategy.js';

const C = (id: string, score: number, extra: Partial<StrategyCandidate> = {}): StrategyCandidate => ({
  id,
  score,
  ...extra,
});

describe('RoutingStrategy (Feature 3 — named combo strategies)', () => {
  let rs: RoutingStrategy;
  beforeEach(() => {
    rs = new RoutingStrategy();
  });

  it('priority selects the highest-scoring candidate', () => {
    const res = rs.select([C('a', 0.3), C('b', 0.9), C('c', 0.5)], 'priority', 'k1');
    expect(res.selectedId).toBe('b');
    expect(res.strategy).toBe('priority');
  });

  it('round-robin cycles through candidates deterministically per stateKey', () => {
    const pool = [C('a', 0.5), C('b', 0.5), C('c', 0.5)];
    const picks = [1, 2, 3, 4].map(() => rs.select(pool, 'round-robin', 'combo-x').selectedId);
    expect(picks).toEqual(['a', 'b', 'c', 'a']);
  });

  it('round-robin counters are isolated per stateKey', () => {
    const pool = [C('a', 0.5), C('b', 0.5)];
    expect(rs.select(pool, 'round-robin', 'one').selectedId).toBe('a');
    expect(rs.select(pool, 'round-robin', 'two').selectedId).toBe('a');
    expect(rs.select(pool, 'round-robin', 'one').selectedId).toBe('b');
  });

  it('weighted-random honors explicit weights (deterministic with seeded input)', () => {
    // All weight on 'b' → always picks 'b'.
    const pool = [C('a', 0.9, { weight: 0 }), C('b', 0.1, { weight: 100 })];
    for (let i = 0; i < 20; i++) {
      expect(rs.select(pool, 'weighted', `w${i}`).selectedId).toBe('b');
    }
  });

  it('least-used selects the candidate with the fewest usages', () => {
    const pool = [C('a', 0.5, { usageCount: 9 }), C('b', 0.5, { usageCount: 2 }), C('c', 0.5, { usageCount: 5 })];
    const res = rs.select(pool, 'least-used', 'k2');
    expect(res.selectedId).toBe('b');
    expect(res.reasons[0]).toContain('Least-used');
  });

  it('throws when given an empty candidate set', () => {
    expect(() => rs.select([], 'priority', 'k3')).toThrow();
  });

  it('reset clears round-robin state', () => {
    const pool = [C('a', 0.5), C('b', 0.5)];
    expect(rs.select(pool, 'round-robin', 'r').selectedId).toBe('a');
    rs.reset('r');
    expect(rs.select(pool, 'round-robin', 'r').selectedId).toBe('a');
  });
});
