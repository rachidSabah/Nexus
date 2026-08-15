/**
 * ─────────────────────────────────────────────────────────────────────────────
 * IntentClassifier — Deterministic task intent classifier for Agent Orchestrator.
 *
 * Classifies developer prompts into task intent categories and extracts required
 * agent capabilities without incurring LLM latency or cost.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AgentCapabilityTag, TaskIntentCategory, TaskIntentClassification } from '../../domain/agent-orchestrator.js';

interface ClassificationPattern {
  readonly category: TaskIntentCategory;
  readonly matchers: readonly RegExp[];
  readonly capabilities: readonly AgentCapabilityTag[];
  readonly suggestedPolicy: TaskIntentClassification['suggestedPolicy'];
  readonly defaultTimeoutMs: number;
}

const PATTERNS: readonly ClassificationPattern[] = [
  {
    category: 'application-building',
    matchers: [
      /\b(build|scaffold|create|generate|bootstrap)\b.*\b(app|application|saas|project|starter|frontend|backend|service|microservice|platform)\b/i,
      /\b(full[- ]?stack|new project|scaffolding|starter kit)\b/i,
      /\b(autonomous builder|agy)\b/i,
    ],
    capabilities: ['scaffolding', 'application-building', 'coding', 'testing', 'verification'],
    suggestedPolicy: 'nexus/application-builder',
    defaultTimeoutMs: 180_000,
  },
  {
    category: 'testing-debugging',
    matchers: [
      /\b(run.*tests?|fix.*test.*fail|test.*regression|flaky test|failing tests?)\b/i,
      /\b(vitest|jest|pytest|playwright)\b.*\b(fail|fix|run|error)\b/i,
    ],
    capabilities: ['testing', 'debugging', 'coding', 'repository-edit'],
    suggestedPolicy: 'nexus/best-coding-agent',
    defaultTimeoutMs: 120_000,
  },
  {
    category: 'debugging',
    matchers: [
      /\b(fix|debug|bug|exception|error|crash|broken|fault|leak|segfault|500|404|panic)\b/i,
      /\b(troubleshoot|diagnose|root cause|patch)\b/i,
    ],
    capabilities: ['coding', 'repository-edit', 'debugging', 'testing'],
    suggestedPolicy: 'nexus/best-coding-agent',
    defaultTimeoutMs: 120_000,
  },
  {
    category: 'code-review',
    matchers: [
      /\b(review|audit|critique|check quality|inspect|pr review|pull request review)\b/i,
      /\b(analyze codebase|security audit|vulnerability scan)\b/i,
    ],
    capabilities: ['repository-read', 'analysis'],
    suggestedPolicy: 'nexus/best-agent',
    defaultTimeoutMs: 90_000,
  },
  {
    category: 'refactoring',
    matchers: [
      /\b(refactor|clean up|modernize|restructure|extract|modularize|simplify|optimize)\b/i,
      /\b(technical debt|deduplicate|decouple)\b/i,
    ],
    capabilities: ['refactoring', 'coding', 'repository-edit'],
    suggestedPolicy: 'nexus/best-coding-agent',
    defaultTimeoutMs: 120_000,
  },
  {
    category: 'feature-implementation',
    matchers: [
      /\b(implement|add feature|extend|support|create function|create component|new endpoint)\b/i,
      /\b(integrate|hook up|wire up)\b/i,
    ],
    capabilities: ['coding', 'repository-edit', 'terminal'],
    suggestedPolicy: 'nexus/best-coding-agent',
    defaultTimeoutMs: 120_000,
  },
  {
    category: 'repository-analysis',
    matchers: [
      /\b(explain|understand|how does|where is|architecture|overview|diagram|summary)\b/i,
      /\b(search repository|find usage|locate)\b/i,
    ],
    capabilities: ['repository-read', 'analysis'],
    suggestedPolicy: 'nexus/best-agent',
    defaultTimeoutMs: 60_000,
  },
];

export class IntentClassifier {
  /** Deterministically classifies prompt intent and capability needs. */
  classify(prompt: string): TaskIntentClassification {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return {
        category: 'general-coding',
        confidence: 0.5,
        requiredCapabilities: ['coding'],
        suggestedPolicy: 'nexus/auto',
        suggestedTimeoutMs: 90_000,
        explanation: 'Default fallback for unspecified prompt',
      };
    }

    for (const pattern of PATTERNS) {
      for (const matcher of pattern.matchers) {
        if (matcher.test(trimmed)) {
          return {
            category: pattern.category,
            confidence: 0.9,
            requiredCapabilities: pattern.capabilities,
            suggestedPolicy: pattern.suggestedPolicy,
            suggestedTimeoutMs: pattern.defaultTimeoutMs,
            explanation: `Matched intent pattern for ${pattern.category} based on keywords in prompt`,
          };
        }
      }
    }

    // Default general coding
    return {
      category: 'general-coding',
      confidence: 0.75,
      requiredCapabilities: ['coding', 'repository-edit'],
      suggestedPolicy: 'nexus/best-coding-agent',
      suggestedTimeoutMs: 90_000,
      explanation: 'General coding task matched default implementation capabilities',
    };
  }
}
