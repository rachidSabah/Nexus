'use client';

import { Activity, Boxes, Brain, Blocks, Cpu, Gauge, KeyRound, Layers, Network, Plug, ScrollText, Settings, Settings2, ShieldAlert, Store, Terminal, Users, Workflow } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Overview', icon: Gauge },
  { href: '/providers', label: 'Providers', icon: Boxes },
  { href: '/models', label: 'Models', icon: Cpu },
  { href: '/keys', label: 'API Keys', icon: KeyRound },
  { href: '/observability', label: 'Observability', icon: Activity },
  { href: '/intelligence', label: 'Intelligence', icon: ShieldAlert },
  { href: '/audit', label: 'Audit', icon: ScrollText },
  { href: '/router-studio', label: 'Router Studio', icon: Settings2 },
  { href: '/detached-tasks', label: 'Detached Tasks', icon: Terminal },
  { href: '/compression', label: 'Compression Lab', icon: Layers },
  { href: '/agents', label: 'Agents', icon: Boxes },
  { href: '/applications', label: 'Applications', icon: Blocks },
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
        <NexusLogo />
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

/**
 * Futuristic Nexus mark: a hexagonal neural core with orbiting nodes and a
 * softly pulsing glow. Pure SVG (no assets), theme-aware via currentColor.
 */
function NexusLogo() {
  return (
    <svg
      viewBox="0 0 40 40"
      className="h-7 w-7 shrink-0"
      role="img"
      aria-label="Nexus"
    >
      <defs>
        <linearGradient id="nexus-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#ec4899" />
        </linearGradient>
        <filter id="nexus-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* outer rotating ring */}
      <g className="origin-center animate-[spin_14s_linear_infinite]" style={{ transformBox: 'fill-box' }}>
        <circle cx="20" cy="20" r="17" fill="none" stroke="url(#nexus-grad)" strokeWidth="1.2" strokeDasharray="4 5" opacity="0.55" />
      </g>

      {/* hexagon core */}
      <polygon
        points="20,5 33.6,12.5 33.6,27.5 20,35 6.4,27.5 6.4,12.5"
        fill="none"
        stroke="url(#nexus-grad)"
        strokeWidth="1.6"
        strokeLinejoin="round"
        filter="url(#nexus-glow)"
      />

      {/* pulsing inner core */}
      <circle cx="20" cy="20" r="4.6" fill="url(#nexus-grad)">
        <animate attributeName="r" values="4.2;5.4;4.2" dur="2.6s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.75;1;0.75" dur="2.6s" repeatCount="indefinite" />
      </circle>

      {/* orbiting nodes */}
      <g fill="#22d3ee">
        <circle cx="20" cy="5" r="1.8" />
        <circle cx="33.6" cy="27.5" r="1.6" />
        <circle cx="6.4" cy="27.5" r="1.6" />
      </g>
    </svg>
  );
}
