/**
 * Example: configure multiple providers with failover.
 *
 * This example shows how to programmatically construct a routing engine
 * with primary → secondary → tertiary failover.
 */
import { InMemoryEventBus, RoutingEngine, NoEligibleProviderError } from '../packages/core/src/index.js';

async function main(): Promise<void> {
  const bus = new InMemoryEventBus();
  const engine = new RoutingEngine(bus);

  // Register three endpoints with different priorities.
  // Lower priority value = higher precedence in `priority` strategy.
  engine.registerEndpoint({
    id: 'openai-primary',
    providerId: 'openai',
    displayName: 'OpenAI Primary',
    baseUrl: 'https://api.openai.com/v1',
    capabilities: {
      streaming: true, toolCalling: true, vision: false, audio: false,
      speech: false, embeddings: true, reasoning: false, jsonMode: true,
      maxOutputTokens: 4096, maxInputTokens: 32768, supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0.01, outputPer1K: 0.03, currency: 'USD' },
    priority: 1, weight: 10, region: 'us-east', tags: ['gpt-4'],
    timeoutMs: 30_000, maxRetries: 2, concurrencyLimit: 10,
    health: 'healthy', createdAt: new Date(), updatedAt: new Date(),
  });

  engine.registerEndpoint({
    id: 'anthropic-failover',
    providerId: 'anthropic',
    displayName: 'Anthropic Failover',
    baseUrl: 'https://api.anthropic.com',
    capabilities: {
      streaming: true, toolCalling: true, vision: true, audio: false,
      speech: false, embeddings: false, reasoning: false, jsonMode: true,
      maxOutputTokens: 8192, maxInputTokens: 200000, supportedModalities: ['text', 'image'],
    },
    pricing: { inputPer1K: 0.003, outputPer1K: 0.015, currency: 'USD' },
    priority: 2, weight: 5, region: 'us-east', tags: ['claude-3-5-sonnet'],
    timeoutMs: 30_000, maxRetries: 2, concurrencyLimit: 10,
    health: 'healthy', createdAt: new Date(), updatedAt: new Date(),
  });

  engine.registerEndpoint({
    id: 'ollama-last-resort',
    providerId: 'ollama',
    displayName: 'Ollama (local, free)',
    baseUrl: 'http://localhost:11434/v1',
    capabilities: {
      streaming: true, toolCalling: true, vision: false, audio: false,
      speech: false, embeddings: true, reasoning: false, jsonMode: true,
      maxOutputTokens: 4096, maxInputTokens: 8192, supportedModalities: ['text'],
    },
    pricing: { inputPer1K: 0, outputPer1K: 0, currency: 'USD' },
    priority: 3, weight: 1, region: 'local', tags: ['llama3'],
    timeoutMs: 60_000, maxRetries: 0, concurrencyLimit: 1,
    health: 'healthy', createdAt: new Date(), updatedAt: new Date(),
  });

  // Resolve with priority strategy → should pick openai-primary
  const decision = await engine.resolve({ model: 'gpt-4', strategy: 'priority' });
  console.log('Selected:', decision.endpoint.id, '—', decision.reason);
  console.log('Alternatives:', decision.alternatives.map((e) => e.id));

  // Simulate openai-primary failure
  console.log('\nSimulating OpenAI failure...');
  for (let i = 0; i < 5; i++) {
    engine.recordFailure('openai-primary', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), true);
  }

  // Now resolution should skip openai-primary (circuit open) and pick anthropic
  const decision2 = await engine.resolve({ model: 'gpt-4', strategy: 'priority' });
  console.log('After failure, selected:', decision2.endpoint.id);

  // Try least_cost strategy
  const decision3 = await engine.resolve({ model: 'gpt-4', strategy: 'least_cost' });
  console.log('Least cost:', decision3.endpoint.id, '—', decision3.reason);

  // Try with capability filter
  try {
    const decision4 = await engine.resolve({
      model: 'gpt-4',
      capabilities: { vision: true },
      strategy: 'capability_match',
    });
    console.log('Vision-capable:', decision4.endpoint.id);
  } catch (err) {
    if (err instanceof NoEligibleProviderError) {
      console.log('No vision-capable endpoint available');
    } else {
      throw err;
    }
  }
}

main().catch(console.error);
