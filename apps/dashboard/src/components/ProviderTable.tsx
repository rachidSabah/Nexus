'use client';

import type { Provider } from '@/hooks/api';

export function ProviderTable({ providers }: { providers: Provider[] }) {
  if (providers.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        No providers registered. Add some via the config file or{' '}
        <code className="rounded bg-white/5 px-1">anx config</code>.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wider text-white/40">
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
        <tbody>
          {providers.map((p) => (
            <tr key={p.id} className="border-b border-white/[0.02] hover:bg-white/[0.02]">
              <td className="px-3 py-2 font-mono text-xs">{p.id}</td>
              <td className="px-3 py-2">{p.displayName}</td>
              <td className="px-3 py-2">
                <span className={`pill pill-${p.health}`}>{p.health}</span>
              </td>
              <td className="px-3 py-2 font-mono">{p.priority}</td>
              <td className="px-3 py-2 font-mono">{p.weight}</td>
              <td className="px-3 py-2 text-xs text-white/60">{p.region ?? '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">
                ${p.pricing?.inputPer1K ?? 0} / ${p.pricing?.outputPer1K ?? 0}
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {p.capabilities.streaming && <span className="pill bg-white/5 text-white/60">stream</span>}
                  {p.capabilities.toolCalling && <span className="pill bg-white/5 text-white/60">tools</span>}
                  {p.capabilities.vision && <span className="pill bg-white/5 text-white/60">vision</span>}
                  {p.capabilities.embeddings && <span className="pill bg-white/5 text-white/60">embed</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
