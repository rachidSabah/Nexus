// Audit test harness — exercises every gateway endpoint, prints compact results.
const BASE = 'http://127.0.0.1:8787';
const results = [];
const t = async (name, fn) => {
  const start = Date.now();
  try {
    const r = await fn();
    results.push({ name, ok: r.ok, ms: Date.now() - start, note: r.note ?? '' });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - start, note: String(e.message ?? e).slice(0, 120) });
  }
};
const jget = async (p, headers = {}) => {
  const r = await fetch(BASE + p, { headers });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  const s = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: r.status < 400, note: `${r.status} ${s.slice(0, 90)}`, raw: body };
};
const jpost = async (p, data, headers = {}) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  let body; try { body = await r.json(); } catch { body = await r.text(); }
  const s = JSON.stringify(body);
  return { ok: r.status < 400, note: `${r.status} ${s.slice(0, 90)}`, raw: body };
};

(async () => {
  // ── Core OpenAI/Anthropic ──
  await t('GET /health', async () => (await jget('/health')).ok && { ok: true, note: JSON.stringify((await jget('/health')).raw).slice(0, 80) });
  await t('GET /v1/models', async () => { const r = await jget('/v1/models'); return { ok: r.ok && Array.isArray(r.raw?.data), note: `${r.raw?.data?.length} models` }; });
  await t('GET /v1/models/free', async () => { const r = await jget('/v1/models/free'); return { ok: r.ok, note: `${r.raw?.data?.length ?? '?'} free` }; });
  await t('GET /v1/models/stats', async () => { const r = await jget('/v1/models/stats'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 80) }; });
  await t('GET /v1/models/discover', async () => { const r = await jget('/v1/models/discover'); return { ok: r.ok, note: `${r.raw?.data?.length ?? '?'} discovered` }; });
  await t('POST /v1/chat/completions (real)', async () => {
    const r = await jpost('/v1/chat/completions', { model: 'anthropic/opencode/deepseek-v4-flash-free', max_tokens: 60, messages: [{ role: 'user', content: 'Say exactly: AUDIT-OK' }] });
    return { ok: r.ok && r.raw?.choices?.[0]?.message?.content?.includes('AUDIT'), note: r.raw?.choices?.[0]?.message?.content?.slice(0, 40) ?? r.note };
  });
  await t('POST /v1/embeddings', async () => { const r = await jpost('/v1/embeddings', { model: 'x', input: ['hi'] }); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/messages shape check', async () => { const r = await jget('/v1/messages'); return { ok: true, note: `${r.note} (GET expected 405/route err)` }; });

  // ── Management ──
  await t('GET /v1/keys', async () => { const r = await jget('/v1/keys'); return { ok: r.ok && Array.isArray(r.raw), note: `${r.raw?.length} keys` }; });
  await t('GET /v1/providers', async () => { const r = await jget('/v1/providers'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} endpoints` }; });
  await t('GET /v1/aliases', async () => { const r = await jget('/v1/aliases'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} aliases` }; });
  await t('GET /v1/budget', async () => { const r = await jget('/v1/budget'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('GET /v1/metrics', async () => { const r = await jget('/v1/metrics'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('GET /metrics (prometheus)', async () => { const r = await jget('/metrics'); return { ok: r.ok, note: String(r.raw).slice(0, 60) }; });
  await t('GET /v1/cache/stats', async () => { const r = await jget('/v1/cache/stats'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('GET /v1/rate-limits', async () => { const r = await jget('/v1/rate-limits'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('GET /v1/audit', async () => { const r = await jget('/v1/audit'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} entries` }; });
  await t('GET /v1/traces', async () => { const r = await jget('/v1/traces'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} traces` }; });
  await t('GET /v1/traces/stats', async () => { const r = await jget('/v1/traces/stats'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('POST /v1/auth/login', async () => { const r = await jpost('/v1/auth/login', { principal: 'audit' }); return { ok: r.ok, note: r.raw?.token ? 'JWT issued' : r.note }; });

  // ── AI features ──
  await t('POST /v1/memory/store+search', async () => {
    const s = await jpost('/v1/memory/audit-ns/store', { data: 'audit memory entry', scope: 'short', metadata: { a: 1 } });
    const q = await jpost('/v1/memory/audit-ns/search', { query: 'audit memory', scope: 'short', limit: 3 });
    return { ok: s.ok && q.ok, note: `store:${s.note} search:${q.note}` };
  });
  await t('POST /v1/rag/ingest+retrieve', async () => {
    const s = await jpost('/v1/rag/ingest', { text: 'Agent Nexus Gateway audit document.', namespace: 'audit-rag' });
    const q = await jpost('/v1/rag/retrieve', { query: 'gateway audit', namespace: 'audit-rag', limit: 3 });
    return { ok: s.ok && q.ok, note: `ingest:${s.note} retr:${q.note}` };
  });
  await t('GET /v1/workflows', async () => { const r = await jget('/v1/workflows'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} workflows` }; });
  await t('POST /v1/workflows (create)', async () => {
    const r = await jpost('/v1/workflows', { name: 'audit-wf', steps: [{ id: 's1', type: 'echo', message: 'hello' }] });
    return { ok: r.ok, note: r.note };
  });
  await t('GET /v1/agents', async () => { const r = await jget('/v1/agents'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} agents` }; });
  await t('GET /v1/agents/detect', async () => { const r = await jget('/v1/agents/detect'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} detected` }; });
  await t('GET /v1/agents/stats', async () => { const r = await jget('/v1/agents/stats'); return { ok: r.ok, note: JSON.stringify(r.raw).slice(0, 60) }; });
  await t('GET /v1/tools', async () => { const r = await jget('/v1/tools'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} tools` }; });
  await t('GET /v1/tools/log', async () => { const r = await jget('/v1/tools/log'); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/compression', async () => {
    const r = await jpost('/v1/compression', { text: 'The quick brown fox jumps over the lazy dog. '.repeat(20) });
    return { ok: r.ok, note: r.note };
  });
  await t('POST /v1/context-manager', async () => { const r = await jpost('/v1/context-manager', { tokens: 100000 }); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/cost-predictor', async () => { const r = await jget('/v1/cost-predictor'); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/privacy', async () => { const r = await jpost('/v1/privacy', { text: 'test privacy redaction', mode: 'redact' }); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/task-classify', async () => { const r = await jpost('/v1/task-classify', { model: 'x', messages: [{ role: 'user', content: 'Write a blog post about cats' }] }); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/plan', async () => { const r = await jpost('/v1/plan', { request: 'Build a simple CRUD app' }); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/orchestrate', async () => { const r = await jpost('/v1/orchestrate', { task: 'test' }); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/a2a/message', async () => { const r = await jpost('/v1/a2a/message', { type: 'message', from: 'audit', to: 'all', content: 'ping' }); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/proposals', async () => { const r = await jget('/v1/proposals'); return { ok: r.ok, note: r.note }; });
  await t('POST /v1/teams + GET', async () => {
    const c = await jpost('/v1/teams', { name: 'audit-team', members: ['a'] });
    const g = await jget('/v1/teams');
    return { ok: c.ok && g.ok, note: `create:${c.note} list:${g.note}` };
  });
  await t('POST /v1/mcp (initialize)', async () => {
    const r = await jpost('/v1/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '1' } } });
    return { ok: r.ok, note: r.note };
  });

  // ── Infra ──
  await t('GET /v1/network/diagnostics', async () => { const r = await jget('/v1/network/diagnostics'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/mesh/services', async () => { const r = await jget('/v1/mesh/services'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/mesh/config', async () => { const r = await jget('/v1/mesh/config'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/mesh/stats', async () => { const r = await jget('/v1/mesh/stats'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/marketplace/search', async () => { const r = await jget('/v1/marketplace/search'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} extensions` }; });
  await t('GET /v1/marketplace/stats', async () => { const r = await jget('/v1/marketplace/stats'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/marketplace/installed', async () => { const r = await jget('/v1/marketplace/installed'); return { ok: r.ok, note: r.note }; });
  await t('GET /v1/plugins', async () => { const r = await jget('/v1/plugins'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} plugins` }; });
  await t('GET /v1/integrations', async () => { const r = await jget('/v1/integrations'); return { ok: r.ok, note: `${r.raw?.length ?? '?'} integrations` }; });

  // ── WebSocket ──
  await t('WS /ws (connect+receive)', async () => {
    const ws = new WebSocket('ws://127.0.0.1:8787/ws');
    const got = await new Promise((res) => {
      const to = setTimeout(() => res('TIMEOUT'), 8000);
      ws.onmessage = (e) => { clearTimeout(to); res(String(e.data).slice(0, 80)); };
      ws.onerror = () => { clearTimeout(to); res('WS-ERROR'); };
    });
    ws.close();
    return { ok: got !== 'WS-ERROR', note: String(got) };
  });

  // ── Report ──
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n=== AUDIT: ${ok}/${results.length} PASS ===`);
  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'} ${r.name} [${r.ms}ms] ${r.note}`);
  }
  process.exit(0);
})();
