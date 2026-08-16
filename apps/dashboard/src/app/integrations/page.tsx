'use client';

import { Plug, ExternalLink, Sparkles, Terminal, CheckCircle2, AlertCircle, Boxes, Cpu, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

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
    ['CLI Coding Agents', integrations.filter((i) => i.category === 'cli')],
    ['Code Editors & IDEs', integrations.filter((i) => i.category === 'editor' || i.category === 'ide')],
    ['Autonomous Agent Frameworks', integrations.filter((i) => i.category === 'agent')],
  ];

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> One-Click Agent & IDE Harness
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Plug className="h-8 w-8 text-nexus-400" />
            Native Integrations Matrix
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Buckle Claude Code, Cursor, OpenCode, Aider, Codex, VS Code, and DeepSeek Code to your local proxy gateway in seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            href="/agents"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Boxes className="h-3.5 w-3.5 text-nexus-400" /> Runtime Agent Matrix
          </Link>
          <Link
            href="/router-studio"
            className="inline-flex items-center gap-1.5 rounded-xl border border-nexus-500/30 bg-nexus-500/10 px-3 py-1.5 text-xs font-semibold text-nexus-300 transition hover:bg-nexus-500/20"
          >
            <Cpu className="h-3.5 w-3.5 text-nexus-300" /> Router Studio
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 py-12 text-center text-xs text-white/40">
          Scanning system for installed coding agent harnesses...
        </div>
      ) : (
        groups.map(([label, items]) =>
          items.length === 0 ? null : (
            <div key={label} className="space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 flex items-center gap-2">
                <Terminal className="h-4 w-4 text-nexus-400" /> {label} ({items.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
  const [copied, setCopied] = useState(false);
  const installCmd = `anx integrations install ${integration.id}`;

  const copyToClipboard = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(installCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 backdrop-blur-xl transition hover:border-nexus-500/40 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <div className="font-bold text-sm text-white">{integration.displayName}</div>
            <div className="text-xs text-white/50 mt-0.5">{integration.description}</div>
          </div>
          {integration.homepage && (
            <a
              href={integration.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/40 transition hover:text-white flex items-center gap-1 text-[11px]"
              title={`Visit official documentation for ${integration.displayName}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <code className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-nexus-300">
            {integration.id}
          </code>
          {integration.installed ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-400">
              <AlertCircle className="h-3 w-3" /> Not Detected
            </span>
          )}
          {integration.configured && (
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
              Configured
            </span>
          )}
        </div>

        {integration.configPath && (
          <div className="mt-2 truncate font-mono text-[10px] text-white/40" title={integration.configPath}>
            Config: {integration.configPath}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={copyToClipboard}
        className="mt-4 flex items-center justify-between rounded-xl border border-white/5 bg-black/50 p-2.5 font-mono text-[11px] text-white/70 hover:bg-black/70 hover:border-nexus-500/30 transition text-left cursor-pointer group"
        title="Click to copy install command"
      >
        <span className="truncate">
          <span className="text-nexus-400 mr-1.5">$</span>
          {installCmd}
        </span>
        <span className="ml-2 shrink-0 text-white/40 group-hover:text-nexus-400 transition">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
    </div>
  );
}

