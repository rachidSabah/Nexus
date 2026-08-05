'use client';

import useSWR from 'swr';
import { Plug, ExternalLink } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface IntegrationStatus {
  id: string;
  displayName: string;
  description: string;
  category: 'cli' | 'editor' | 'ide' | 'agent';
  homepage?: string;
  installed: boolean;
  configured: boolean;
  configPath?: string;
  details?: string;
}

export default function IntegrationsPage() {
  const { data, isLoading } = useSWR<{ count: number; integrations: IntegrationStatus[] }>(
    '/api/v1/integrations',
    fetcher,
    { refreshInterval: 30_000 },
  );

  const integrations = data?.integrations ?? [];
  const groups: Array<[string, IntegrationStatus[]]> = [
    ['CLI tools', integrations.filter((i) => i.category === 'cli')],
    ['Editors', integrations.filter((i) => i.category === 'editor')],
    ['IDEs', integrations.filter((i) => i.category === 'ide')],
    ['Agents', integrations.filter((i) => i.category === 'agent')],
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Plug className="h-6 w-6 text-nexus-400" />
          Integrations
        </h1>
        <p className="text-sm text-white/50">
          {data?.count ?? 0} native integrations. Configure them from the CLI with{' '}
          <code className="rounded bg-white/5 px-1">anx integrations install &lt;id&gt;</code>.
        </p>
      </div>

      {isLoading ? (
        <div className="card py-8 text-center text-sm text-white/40">Loading…</div>
      ) : (
        groups.map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label}>
              <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-white/40">
                {label} ({items.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {items.map((i) => (
                  <IntegrationCard key={i.id} integration={i} />
                ))}
              </div>
            </div>
          ),
        )
      )}
    </div>
  );
}

function IntegrationCard({ integration }: { integration: IntegrationStatus }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium">{integration.displayName}</div>
          <div className="text-xs text-white/40">{integration.description}</div>
        </div>
        {integration.homepage && (
          <a
            href={integration.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/30 transition hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <code className="rounded bg-white/5 px-1.5 py-0.5 text-nexus-300">{integration.id}</code>
        {integration.installed ? (
          <span className="pill pill-healthy">installed</span>
        ) : (
          <span className="pill pill-unhealthy">not installed</span>
        )}
        {integration.configured && <span className="pill pill-healthy">configured</span>}
      </div>

      {integration.configPath && (
        <div className="mt-2 truncate font-mono text-[10px] text-white/30">{integration.configPath}</div>
      )}

      <div className="mt-3 rounded-md bg-black/30 p-2 font-mono text-[11px] text-white/50">
        <span className="text-white/30">$</span> anx integrations install {integration.id}
      </div>
    </div>
  );
}
