'use client';

/**
 * Client helper for dashboard mutations against the gateway via the /api/*
 * proxy (next.config rewrites → NEXUS_GATEWAY_URL, default http://127.0.0.1:8787).
 *
 * The dashboard historically swallowed every mutation error (`catch { /* swallow *\/ }`),
 * which made failing actions look like dead buttons. postAction() classifies
 * the failure and returns an actionable banner item instead of hiding the
 * cause. Returns null when the request succeeded.
 */

export interface ActionFailure {
  title: string;
  detail: string;
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function gatewayHint(): string {
  return 'the dashboard proxies /api/* to NEXUS_GATEWAY_URL (default http://127.0.0.1:8787) — check the gateway process is running and the URL matches, then retry';
}

export async function postAction(url: string, body: unknown, failureTitle: string): Promise<ActionFailure | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { title: 'Gateway unreachable', detail: `${describeError(err)} — ${gatewayHint()}` };
  }
  if (res.ok) return null;

  const payload = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string; reasons?: string[] } }
    | null;
  const message = payload?.error?.message ?? `HTTP ${res.status}`;
  let detail: string;
  if (res.status === 401) {
    detail =
      `${message} — /v1/intelligence/* sits behind the gateway's authenticated-management floor and dashboard calls carry ` +
      'no bearer token. Use an open install (no principals with an apiKeyHash registered) or proxy with a gateway token';
  } else if (res.status === 403) {
    detail =
      `${message} — the principal lacks the required intelligence:* permission ` +
      '(operator may discover/prepare/verify; approve and publish require admin)';
  } else if (res.status === 503) {
    detail = `${message} — the intelligence engine is not configured in this server build (a standard gateway start always wires it)`;
  } else if (res.status === 422 && payload?.error?.reasons?.length) {
    detail = `${message}: ${payload.error.reasons.join('; ')}`;
  } else {
    detail = `${message} (HTTP ${res.status})`;
  }
  return { title: failureTitle, detail };
}
