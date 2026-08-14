export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskAnalysis {
  readonly level: RiskLevel;
  readonly score: number;
  readonly flags: readonly string[];
  readonly requiresApproval: boolean;
}

export class RiskEngine {
  analyze(prompt: string): RiskAnalysis {
    const flags: string[] = [];
    let score = 10;

    const lower = prompt.toLowerCase();

    if (lower.includes('delete') || lower.includes('rm -rf') || lower.includes('remove')) {
      flags.push('FILE_DELETION_RISK');
      score += 40;
    }
    if (lower.includes('deploy') || lower.includes('release') || lower.includes('publish')) {
      flags.push('DEPLOYMENT_RISK');
      score += 30;
    }
    if (lower.includes('credential') || lower.includes('secret') || lower.includes('password') || lower.includes('key')) {
      flags.push('CREDENTIAL_RISK');
      score += 50;
    }
    if (lower.includes('exec') || lower.includes('sudo') || lower.includes('shell')) {
      flags.push('SHELL_EXECUTION_RISK');
      score += 25;
    }

    let level: RiskLevel = 'LOW';
    if (score >= 80) level = 'CRITICAL';
    else if (score >= 50) level = 'HIGH';
    else if (score >= 30) level = 'MEDIUM';

    return {
      level,
      score,
      flags,
      requiresApproval: level === 'HIGH' || level === 'CRITICAL',
    };
  }
}
