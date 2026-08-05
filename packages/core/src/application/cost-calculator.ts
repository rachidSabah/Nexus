import type { TokenUsage } from '../domain/types.js';

import { computeCost } from './chat-completion.usecase.js';
import type { CostCalculatorPort } from './ports.js';

/**
 * Default cost calculator — linear per 1K tokens, no tiering.
 */
export class DefaultCostCalculator implements CostCalculatorPort {
  calculate(
    usage: TokenUsage,
    pricing: { inputPer1K: number; outputPer1K: number; cachedInputPer1K?: number },
  ) {
    return computeCost(usage, pricing);
  }
}
