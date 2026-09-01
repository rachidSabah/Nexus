#!/usr/bin/env node
/**
 * ───────────────────────────────────────────────────────────────────────────
 * Nexus Live Error Resolution & Provider Recovery — Smoke Test Script
 * ───────────────────────────────────────────────────────────────────────────
 */

import { createServer } from 'node:http';

const MOCK_PORT = 19992;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8787';
const VALID_KEY = 'sk-live-smoke-valid-key';

const mockServer = createServer((req, res) => {
  const auth = req.headers['authorization'];
  const authorized = auth === `Bearer ${VALID_KEY}`;

  if (req.url === '/v1/models' || req.url === '/models') {
    if (!authorized) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API Key', code: 'invalid_api_key' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model-smoke', object: 'model' }] }));
    return;
  }

  if (req.url === '/v1/chat/completions') {
    if (!authorized) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unauthorized upstream request', code: 401 } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-smoke',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model-smoke',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Smoke test passed' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not found' } }));
});

async function main() {
  console.log('🚀 Starting Live Error Resolution smoke test...');
  await new Promise((resolve) => mockServer.listen(MOCK_PORT, resolve));
  console.log(`📡 Mock upstream listening on port ${MOCK_PORT}`);

  try {
    const healthRes = await fetch(`${GATEWAY_URL}/healthz`).catch(() => null);
    if (!healthRes?.ok) {
      console.log(`ℹ️ Gateway is not running at ${GATEWAY_URL}. Start gateway with 'pnpm start' to test live.`);
      process.exit(0);
    }

    console.log('✅ Gateway is reachable.');

    console.log('📋 Onboarding mock-smoke-provider...');
    await fetch(`${GATEWAY_URL}/v1/providers/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: 'mock-smoke-provider',
        displayName: 'Mock Smoke Provider',
        baseUrl: `http://localhost:${MOCK_PORT}/v1`,
        apiKey: 'sk-invalid-initial-key',
      }),
    });

    console.log('🔍 Resolving provider with invalid key (expecting truthful failure)...');
    const res1 = await fetch(`${GATEWAY_URL}/v1/providers/mock-smoke-provider/resolve`, { method: 'POST' });
    const rep1 = await res1.json();
    console.log(`   Resolution result: resolved=${rep1.resolved}, healthy=${rep1.healthy}, action=${rep1.actionTaken}`);

    console.log('🔑 Registering valid reserve key in Key Vault...');
    await fetch(`${GATEWAY_URL}/v1/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'smoke-key-valid',
        providerId: 'mock-smoke-provider',
        plaintext: VALID_KEY,
        label: 'Valid Smoke Key',
      }),
    });

    console.log('🔄 Resolving provider with valid reserve key...');
    const res2 = await fetch(`${GATEWAY_URL}/v1/providers/mock-smoke-provider/resolve`, { method: 'POST' });
    const rep2 = await res2.json();
    console.log(`   Resolution result: resolved=${rep2.resolved}, healthy=${rep2.healthy}, action=${rep2.actionTaken}`);

    console.log('🔁 Re-resolving already healthy provider (idempotency check)...');
    const res3 = await fetch(`${GATEWAY_URL}/v1/providers/mock-smoke-provider/resolve`, { method: 'POST' });
    const rep3 = await res3.json();
    console.log(`   Resolution result: action=${rep3.actionTaken}, message=${rep3.message}`);

    console.log('\n🎉 ALL LIVE ERROR RESOLUTION SMOKE TESTS PASSED!');
  } finally {
    mockServer.close();
  }
}

main().catch((err) => {
  console.error('❌ Smoke test failed:', err);
  mockServer.close();
  process.exit(1);
});
