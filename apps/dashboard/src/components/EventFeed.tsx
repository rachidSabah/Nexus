'use client';

interface EventFeedProps {
  events: Array<{ type: string; occurredAt: string; payload: unknown }>;
}

const TYPE_COLORS: Record<string, string> = {
  'request.received': 'text-nexus-400',
  'route.resolved': 'text-sky-400',
  'provider.request.started': 'text-amber-400',
  'provider.request.succeeded': 'text-emerald-400',
  'provider.request.failed': 'text-rose-400',
  'failover.triggered': 'text-fuchsia-400',
  'health.changed': 'text-violet-400',
  'circuit_breaker.tripped': 'text-rose-400',
  'cache.hit': 'text-emerald-400',
  'cache.miss': 'text-white/40',
};

export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        Waiting for events… (the gateway must be running)
      </div>
    );
  }
  return (
    <div className="max-h-96 overflow-y-auto font-mono text-xs">
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-3 border-b border-white/[0.02] py-2">
          <span className="text-white/30">{new Date(e.occurredAt).toLocaleTimeString()}</span>
          <span className={`min-w-[180px] font-semibold ${TYPE_COLORS[e.type] ?? 'text-white/60'}`}>
            {e.type}
          </span>
          <span className="flex-1 text-white/60">
            {summarizePayload(e.type, e.payload)}
          </span>
        </div>
      ))}
    </div>
  );
}

function summarizePayload(type: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'request.received':
      return `${p['model']} · streaming=${p['streaming']}`;
    case 'route.resolved':
      return `${p['providerId']}/${p['endpointId']} via ${p['strategy']}`;
    case 'provider.request.succeeded':
      return `${p['providerId']} · ${p['latencyMs']}ms · ${p['inputTokens']}+${p['outputTokens']} tok · $${p['costUsd']}`;
    case 'provider.request.failed':
      return `${p['providerId']} attempt ${p['attempt']} · ${p['error']}`;
    case 'failover.triggered':
      return `${p['fromEndpointId']} → ${p['toEndpointId']} (${p['reason']})`;
    case 'health.changed':
      return `${p['endpointId']}: ${p['from']} → ${p['to']}`;
    case 'circuit_breaker.tripped':
      return `${p['endpointId']} (${p['failureCount']}/${p['threshold']})`;
    default:
      return JSON.stringify(p).slice(0, 120);
  }
}
