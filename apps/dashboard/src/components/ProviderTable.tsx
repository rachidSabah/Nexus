'use client';

import type { Provider } from '@/hooks/api';

export function ProviderTable({ providers }: { providers: readonly Provider[] }) {
  if (!providers || providers.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        No providers registered. Set environment variables (OPENAI_API_KEY,
        ANTHROPIC_API_KEY, etc.) or add endpoints in the config file.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" style={{ background: 'transparent' }}>
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-white/50" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <th className="px-3 py-2 font-medium">Endpoint</th>
            <th className="px-3 py-2 font-medium">Provider</th>
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Weight</th>
            <th className="px-3 py-2 font-medium">Region</th>
            <th className="px-3 py-2 font-medium">Pricing / 1K</th>
            <th className="px-3 py-2 font-medium">Capabilities</th>
          </tr>
        </thead>
        <tbody style={{ background: 'transparent' }}>
          {providers.map((p) => (
            <tr key={p.id} className="border-b border-white/[0.05]" style={{ background: 'transparent' }}>
              <td className="px-3 py-2 font-mono text-xs text-white/70">{p.id}</td>
              <td className="px-3 py-2 text-white/80">{p.displayName}</td>
              <td className="px-3 py-2">
                <span className={`pill ${p.health === 'healthy' ? 'pill-healthy' : p.health === 'degraded' ? 'pill-degraded' : 'pill-unhealthy'}`}>
                  {p.health}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-white/60">{p.priority}</td>
              <td className="px-3 py-2 font-mono text-white/60">{p.weight}</td>
              <td className="px-3 py-2 text-xs text-white/50">{p.region ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs text-white/50">
                ${p.pricing?.inputPer1K ?? 0} / ${p.pricing?.outputPer1K ?? 0}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {p.capabilities.streaming && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">stream</span>}
                  {p.capabilities.toolCalling && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">tools</span>}
                  {p.capabilities.vision && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">vision</span>}
                  {p.capabilities.embeddings && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">embed</span>}
                  {p.capabilities.reasoning && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-white/60">reason</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
