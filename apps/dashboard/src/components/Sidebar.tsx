'use client';

import { Activity, Boxes, Brain, Gauge, KeyRound, Layers, Network, Plug, ScrollText, Settings, Settings2, Store, Terminal, Users, Workflow } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/providers', label: 'Providers', icon: Boxes },
  { href: '/keys', label: 'API Keys', icon: KeyRound },
  { href: '/router-studio', label: 'Router Studio', icon: Settings2 },
  { href: '/agents', label: 'Agents', icon: Boxes },
  { href: '/workflows', label: 'Workflows', icon: Workflow },
  { href: '/workflow-editor', label: 'Editor', icon: Workflow },
  { href: '/teams', label: 'Teams', icon: Users },
  { href: '/memory', label: 'Memory', icon: Brain },
  { href: '/requests', label: 'Requests', icon: Activity },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/marketplace', label: 'Marketplace', icon: Store },
  { href: '/logs', label: 'Logs', icon: ScrollText },
  { href: '/plugins', label: 'Plugins', icon: Layers },
  { href: '/network', label: 'Network', icon: Network },
  { href: '/security', label: 'Security', icon: KeyRound },
  { href: '/mcp', label: 'MCP', icon: Terminal },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 flex-col border-r border-white/5 bg-black/30">
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="h-7 w-7 rounded-md bg-gradient-to-br from-nexus-500 to-fuchsia-500" />
        <div className="font-semibold tracking-tight">Agent Nexus</div>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-link ${active ? 'nav-link-active' : ''}`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-3 text-xs text-white/30">
        Apache-2.0
      </div>
    </aside>
  );
}
