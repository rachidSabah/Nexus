/**
 * ───────────────────────────────────────────────────────────────────────────
 * BudgetManager — tracks spend and auto-switches to cheaper models at
 * budget thresholds. Master prompt "Budget-Aware Routing" feature.
 *
 * How it works:
 *   1. User sets a daily/monthly budget (e.g. $5/day)
 *   2. Every successful request records its costUsd
 *   3. At 80% budget → auto-switch alias resolution prefers cheaper models
 *   4. At 100% budget → free-only models enforced
 *   5. At 120% budget → requests blocked with BUDGET_EXCEEDED error
 *   6. Budget resets at the configured interval (daily = midnight UTC)
 *
 * The BudgetManager is consulted by ChatCompletionUseCase BEFORE routing
 * to determine the effective budget mode, and AFTER success to record spend.
 * ───────────────────────────────────────────────────────────────────────────
 */

export type BudgetMode = 'normal' | 'cost_aware' | 'free_only' | 'blocked';
export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export interface BudgetConfig {
  enabled: boolean;
  /** Max spend in USD per period. */
  limitUsd: number;
  /** Period: daily resets at UTC midnight, weekly on Monday, monthly on 1st. */
  period: BudgetPeriod;
  /** Threshold (0..1) at which to switch to cost_aware mode. Default: 0.8 */
  costAwareThreshold: number;
  /** Threshold (0..1) at which to switch to free_only mode. Default: 1.0 */
  freeOnlyThreshold: number;
  /** Threshold (0..1) at which to block requests. Default: 1.2 (20% over) */
  blockThreshold: number;
}

export const DEFAULT_BUDGET_CONFIG: BudgetConfig = {
  enabled: false,
  limitUsd: 5.0,
  period: 'daily',
  costAwareThreshold: 0.8,
  freeOnlyThreshold: 1.0,
  blockThreshold: 1.2,
};

export interface BudgetSnapshot {
  config: BudgetConfig;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  mode: BudgetMode;
  periodStart: number;
  periodEnd: number;
  /** How many requests contributed to this spend. */
  requestCount: number;
  /** How much was saved by cost-aware switching (estimated). */
  estimatedSavingsUsd: number;
}

export class BudgetManager {
  private config: BudgetConfig;
  private spentUsd = 0;
  private periodStart: number;
  private requestCount = 0;
  private estimatedSavingsUsd = 0;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.config = { ...DEFAULT_BUDGET_CONFIG, ...config };
    this.periodStart = this.computePeriodStart();
  }

  /** Returns the current budget mode based on spend. */
  getMode(): BudgetMode {
    if (!this.config.enabled) return 'normal';
    const pct = this.getPercentUsed();
    if (pct >= this.config.blockThreshold) return 'blocked';
    if (pct >= this.config.freeOnlyThreshold) return 'free_only';
    if (pct >= this.config.costAwareThreshold) return 'cost_aware';
    return 'normal';
  }

  /** Records a successful request's cost. */
  recordSpend(costUsd: number, estimatedSavingsUsd = 0): void {
    if (!this.config.enabled) return;
    this.checkPeriodReset();
    this.spentUsd += costUsd;
    this.estimatedSavingsUsd += estimatedSavingsUsd;
    this.requestCount++;
  }

  /** Returns a snapshot for the dashboard. */
  getSnapshot(): BudgetSnapshot {
    this.checkPeriodReset();
    const pct = this.getPercentUsed();
    return {
      config: this.config,
      spentUsd: Math.round(this.spentUsd * 10000) / 10000,
      remainingUsd: Math.max(0, Math.round((this.config.limitUsd - this.spentUsd) * 10000) / 10000),
      percentUsed: Math.round(pct * 1000) / 10,
      mode: this.getMode(),
      periodStart: this.periodStart,
      periodEnd: this.computePeriodEnd(),
      requestCount: this.requestCount,
      estimatedSavingsUsd: Math.round(this.estimatedSavingsUsd * 10000) / 10000,
    };
  }

  /** Updates the budget config at runtime (e.g. via POST /v1/budget). */
  updateConfig(updates: Partial<BudgetConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /** Returns true if the current request should be blocked (over budget). */
  shouldBlock(): boolean {
    return this.getMode() === 'blocked';
  }

  /** Returns true if the current mode requires free-only models. */
  requiresFreeOnly(): boolean {
    return this.getMode() === 'free_only';
  }

  /** Returns true if the current mode prefers cheaper models. */
  prefersCheaper(): boolean {
    const mode = this.getMode();
    return mode === 'cost_aware' || mode === 'free_only';
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private getPercentUsed(): number {
    if (this.config.limitUsd <= 0) return 0;
    return this.spentUsd / this.config.limitUsd;
  }

  private checkPeriodReset(): void {
    const now = Date.now();
    const periodEnd = this.computePeriodEnd();
    if (now >= periodEnd) {
      this.spentUsd = 0;
      this.requestCount = 0;
      this.estimatedSavingsUsd = 0;
      this.periodStart = this.computePeriodStart();
    }
  }

  private computePeriodStart(): number {
    const now = new Date();
    switch (this.config.period) {
      case 'daily': {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
      }
      case 'weekly': {
        const day = now.getUTCDay();
        const diff = day === 0 ? 6 : day - 1; // Monday = 0
        const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
        return monday.getTime();
      }
      case 'monthly': {
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime();
      }
    }
  }

  private computePeriodEnd(): number {
    switch (this.config.period) {
      case 'daily': {
        return this.periodStart + 24 * 60 * 60 * 1000;
      }
      case 'weekly': {
        return this.periodStart + 7 * 24 * 60 * 60 * 1000;
      }
      case 'monthly': {
        const start = new Date(this.periodStart);
        return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).getTime();
      }
    }
  }
}
