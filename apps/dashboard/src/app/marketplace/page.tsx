'use client';

import { Store, Package, Bot, Wrench } from 'lucide-react';

export default function MarketplacePage() {
  const plugins = [
    { name: 'PII Redactor', description: 'Redacts emails, phones, SSNs from responses', category: 'transform', installed: false },
    { name: 'Rate Limiter', description: 'Token bucket per principal / IP', category: 'control', installed: false },
    { name: 'Prompt Injection Detector', description: 'Flag suspicious user input', category: 'security', installed: false },
    { name: 'Cost Guard', description: 'Block requests that exceed budget', category: 'control', installed: false },
    { name: 'Slack Alerter', description: 'Notify on circuit breaker trips', category: 'notify', installed: false },
    { name: 'Webhook Forwarder', description: 'POST events to external URL', category: 'notify', installed: false },
  ];
  const agents = [
    { name: 'Claude Code', description: 'Anthropic agentic coding CLI', installed: true },
    { name: 'OpenCode Zen', description: 'Minimalist AI coding agent', installed: false },
    { name: 'DeepSeek Coder', description: 'Cost-effective backend coding', installed: false },
  ];
  const tools = [
    { name: 'Filesystem', description: 'filesystem.read / write / list', installed: true },
    { name: 'Terminal', description: 'terminal.execute (sandboxed)', installed: false },
    { name: 'Git', description: 'git.status / commit / diff', installed: false },
    { name: 'Browser', description: 'browser.navigate / screenshot', installed: false },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Store className="h-6 w-6 text-nexus-400" />
          Marketplace
        </h1>
        <p className="text-sm text-white/50">Browse and install plugins, agents, and tools.</p>
      </div>

      <Section title="Plugins" icon={<Package className="h-4 w-4" />} items={plugins} />
      <Section title="Agents" icon={<Bot className="h-4 w-4" />} items={agents} />
      <Section title="Tools" icon={<Wrench className="h-4 w-4" />} items={tools} />

      <div className="card">
        <div className="text-sm text-white/50">
          The marketplace is a curated catalog. In a future release, plugins will be signed, versioned, and installable via
          <code className="ml-1 rounded bg-white/5 px-1">anx plugins install &lt;name&gt;</code>.
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<{ name: string; description: string; installed: boolean }>;
}) {
  return (
    <div>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-white/40">
        {icon}
        {title} ({items.length})
      </h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item.name} className="card">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium">{item.name}</div>
                <div className="text-xs text-white/40">{item.description}</div>
              </div>
              {item.installed ? (
                <span className="pill pill-healthy">installed</span>
              ) : (
                <button className="rounded-md bg-nexus-600/80 px-2 py-1 text-xs font-medium text-white hover:bg-nexus-500">
                  Install
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
