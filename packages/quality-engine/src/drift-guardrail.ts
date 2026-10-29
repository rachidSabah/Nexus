export interface ShadowEvalSample {
  providerId: string;
  modelId: string;
  prompt: string;
  responseContent: string;
  expectedJsonSchema?: boolean;
  latencyMs: number;
}

export interface DriftEvaluationVerdict {
  providerId: string;
  modelId: string;
  passed: boolean;
  qualityScore: number; // 0.0 to 1.0
  anomalies: string[];
  recommendedCooldownMs: number;
}

export class QualityDriftGuardrail {
  private readonly providerScores = new Map<string, number[]>();

  public evaluateSample(sample: ShadowEvalSample): DriftEvaluationVerdict {
    const anomalies: string[] = [];
    let score = 1.0;

    // 1. Check for empty or prematurely truncated code blocks
    const fenceMatches = sample.responseContent.match(/```/g);
    if (fenceMatches && fenceMatches.length % 2 !== 0) {
      anomalies.push('UNCLOSED_CODE_FENCE_TRUNCATION');
      score -= 0.45;
    }

    // 2. Check for lazy placeholder comments often emitted by quantized/degraded providers
    if (
      /\/\/\s*\.\.\.\s*(?:rest of code|existing code|implement here|code goes here)/i.test(
        sample.responseContent,
      ) ||
      /#\s*\.\.\.\s*(?:rest of code|existing code|implement here)/i.test(
        sample.responseContent,
      )
    ) {
      anomalies.push('LAZY_OMISSION_PLACEHOLDER_DETECTED');
      score -= 0.35;
    }

    // 3. Validate strict JSON if requested
    if (sample.expectedJsonSchema) {
      try {
        JSON.parse(sample.responseContent);
      } catch {
        anomalies.push('MALFORMED_JSON_SCHEMA_OUTPUT');
        score -= 0.6;
      }
    }

    const clampedScore = Math.max(0, Number(score.toFixed(2)));
    const key = `${sample.providerId}:${sample.modelId}`;
    const history = this.providerScores.get(key) ?? [];
    history.push(clampedScore);
    if (history.length > 20) history.shift();
    this.providerScores.set(key, history);

    const rollingAvg = history.reduce((a, b) => a + b, 0) / history.length;
    const passed = rollingAvg >= 0.7 && clampedScore >= 0.6;

    return {
      providerId: sample.providerId,
      modelId: sample.modelId,
      passed,
      qualityScore: clampedScore,
      anomalies,
      recommendedCooldownMs: passed ? 0 : 300_000, // 5-minute automatic cooldown on drift
    };
  }

  public getHistory(providerId: string, modelId: string): number[] {
    return this.providerScores.get(`${providerId}:${modelId}`) ?? [];
  }

  public clearHistory(): void {
    this.providerScores.clear();
  }
}
