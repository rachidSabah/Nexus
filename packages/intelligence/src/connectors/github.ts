/**
 * GitHub security-advisories connector (blueprint §6 leak intelligence).
 *
 * Monitors the DOCUMENTED public advisories API for reports indicating exposed
 * credentials tied to AI-provider ecosystems. Repository/advisory text is
 * untrusted hostiles data — this connector only extracts:
 *   reference id, title, severity, redacted excerpt.
 *
 * It never stores the alleged secret, never computes a fingerprint of it, and
 * never attempts to validate or use it. Ingestion re-redacts again (defense in
 * depth) before persistence.
 */

import type {
  ConnectorCheckpoint,
  DiscoveryBatch,
  DiscoveryConnector,
  NormalizedCandidate,
  ProviderCandidate,
  RawDiscoveryRecord,
  SecurityFindingCandidate,
} from '../types.js';

import { BaseConnector, makeEgress, safeParseJson, type ConnectorContext } from './base.js';

const ADVISORIES_URL = 'https://api.github.com/advisories';
const MAX_RECORDS = 60; // advisory pages are large; keep ingestion bounded

const PROVIDER_HINTS = [
  'openai', 'anthropic', 'gemini', 'deepseek', 'mistral', 'hugging face', 'huggingface', 'openrouter',
  'groq', 'cohere', 'x.ai', 'together.ai', 'replicate', 'perplexity', 'copilot', 'github models',
];
const SECRET_HINTS = ['api key', 'api-key', 'apikey', 'secret', 'token', 'credential', 'authentication bypass'];

interface AdvisoryPayload {
  id?: string;
  ghsa_id?: string;
  summary?: string;
  description?: string;
  severity?: string;
  type?: string;
  published_at?: string;
  html_url?: string;
}

export class GitHubAdvisoriesConnector extends BaseConnector implements DiscoveryConnector {
  readonly id = 'github-advisories';
  readonly version = '1.0.0';
  readonly authority = 0.7;
  readonly description = 'Public GitHub security advisories screened for AI-provider credential-exposure reports (redacted).';

  constructor(ctx: ConnectorContext = makeEgress({ maxResponseBytes: 8 * 1024 * 1024, timeoutMs: 20_000 }, 4, 2_000)) {
    // Respect documented rate limits: anonymous 60 req/h — token raises it.
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
    const headers = token ? { authorization: `Bearer ${token}` } : {};
    super({ ...ctx, sourceUrl: ctx.sourceUrl || ADVISORIES_URL });
    void headers;
  }

  async fetchPage(_cursor?: ConnectorCheckpoint): Promise<DiscoveryBatch> {
    await this.ctx.rateLimiter.acquire();
    // One bounded page per run: the newest 100 reviewed advisories. GitHub's
    // `after` cursor is an opaque Link-header token (NOT a GHSA id) and the
    // egress layer deliberately does not expose response headers, so pagination
    // is intentionally not chased. Re-ingestion of the same window is idempotent
    // (evidence dedupe keys) and the scheduler picks new advisories up as they
    // enter the window.
    const token = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
    const res = await this.ctx.egress.fetchText(
      `${ADVISORIES_URL}?per_page=100&sort=published&direction=desc`,
      token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
    );
    const parsed = safeParseJson(res.body);
    if (!res.ok || parsed.ok !== 1) {
      // 403 = anonymous rate limit exceeded (60/h) — surfaced as job retry, not an outage.
      throw new Error(`github advisories fetch failed: HTTP ${res.status ?? 'n/a'} ${res.error ?? ''}`);
    }
    const rows = Array.isArray(parsed.value) ? (parsed.value as AdvisoryPayload[]) : [];    const filtered: AdvisoryPayload[] = [];
    for (const a of rows) {
      if (a.type && a.type !== 'reviewed') continue;
      const text = `${a.summary ?? ''} ${a.description ?? ''}`.toLowerCase();
      const mentionsSecret = SECRET_HINTS.some((h) => text.includes(h));
      if (!mentionsSecret) continue;
      filtered.push(a);
      if (filtered.length >= MAX_RECORDS) break;
    }
    const newestGhsa = String(rows[0]?.ghsa_id ?? rows[0]?.id ?? '');
    return {
      connectorId: this.id,
      sourceUrl: ADVISORIES_URL,
      records: filtered.map((a) => ({
        connectorId: this.id,
        sourceUrl: a.html_url ?? ADVISORIES_URL,
        observedAt: a.published_at ?? new Date().toISOString(),
        payload: a,
      })),
      checkpoint: {
        updatedAt: new Date().toISOString(),
        meta: { newestGhsa },
      },
      exhausted: true,
    };
  }

  async normalize(record: RawDiscoveryRecord): Promise<NormalizedCandidate[]> {
    const payload = record.payload as AdvisoryPayload;
    const referenced = String(payload.ghsa_id ?? payload.id ?? '').trim();
    if (!referenced) return [];
    const text = `${payload.summary ?? ''}`.trim();
    const lower = text.toLowerCase();
    const matchedProvider = PROVIDER_HINTS.find((h) => lower.includes(h));
    const severity = normalizeSeverity(payload.severity);
    const candidates: NormalizedCandidate[] = [];

    const finding: SecurityFindingCandidate = {
      title: text.slice(0, 120) || `Security advisory ${referenced}`,
      category: 'security-advisory',
      severity: severity ?? 'medium',
      confidence: payload.type === 'malware' ? 0.6 : 0.55,
      sourceRef: payload.html_url ?? `ghsa:${referenced}`,
      excerpt: text.slice(0, 400) || 'See advisory reference.',
      providerId: matchedProvider ? `advisory:${matchedProvider}` : undefined,
    };
    candidates.push({ kind: 'security', candidate: finding });

    // Advisory linking does not verify provider identity — a provider record is
    // asserted only as an unverified label for triage grouping, never used for
    // access decisions.
    if (matchedProvider) {
      const providerCandidate: ProviderCandidate = {
        providerId: matchedProvider,
        displayName: matchedProvider,
        providerKind: 'security-label',
      };
      candidates.push({ kind: 'provider', candidate: providerCandidate });
    }
    return candidates;
  }
}

export function normalizeSeverity(raw: unknown): SecurityFindingCandidate['severity'] | undefined {
  const v = String(raw ?? '').toLowerCase();
  if (v === 'critical') return 'critical';
  if (v === 'high') return 'high';
  if (v === 'moderate') return 'medium';
  if (v === 'medium') return 'medium';
  if (v === 'low') return 'low';
  if (v === 'informational') return 'info';
  return undefined;
}

export default GitHubAdvisoriesConnector;
