'use client';

import { Moon, Search, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getStoredTheme, onThemeChange, setTheme, type ThemeMode } from '@/lib/theme';

const NAV_TARGETS = [
  { pattern: /^(prov|model)/i, href: '/providers' },
  { pattern: /^(agent|bot)/i, href: '/agents' },
  { pattern: /^(workflow|flow)/i, href: '/workflows' },
  { pattern: /^(team|vote)/i, href: '/teams' },
  { pattern: /^(mem|brain)/i, href: '/memory' },
  { pattern: /^(req|event|live)/i, href: '/requests' },
  { pattern: /^(int|tool)/i, href: '/integrations' },
  { pattern: /^(market|plug)/i, href: '/marketplace' },
  { pattern: /^(log|audit)/i, href: '/logs' },
  { pattern: /^(mesh|gateway)/i, href: '/providers' },
  { pattern: /^(net|dns|proxy)/i, href: '/network' },
  { pattern: /^(sec|cred|rbac|jwt|vault)/i, href: '/security' },
  { pattern: /^(mcp|context)/i, href: '/mcp' },
  { pattern: /^(set|config)/i, href: '/settings' },
  { pattern: /^(home|overv|dash)/i, href: '/' },
];

export function Topbar() {
  const [time, setTime] = useState<string>('');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [search, setSearch] = useState<string>('');
  const router = useRouter();

  // Sync with canonical theme system
  useEffect(() => {
    setThemeMode(getStoredTheme());
    const unsub = onThemeChange((mode) => setThemeMode(mode));
    return unsub;
  }, []);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) return;
    // Try to match a known target by prefix.
    for (const t of NAV_TARGETS) {
      if (t.pattern.test(q)) {
        router.push(t.href);
        setSearch('');
        return;
      }
    }
    // Fallback: treat as a request ID / model alias → providers page.
    router.push('/providers');
    setSearch('');
  }

  const isDark = themeMode !== 'light';

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-black/20 px-8">
      <form onSubmit={handleSearch} className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers, agents, workflows, logs…"
            className="h-9 w-80 rounded-lg border border-white/5 bg-white/[0.02] pl-8 pr-3 text-sm placeholder:text-white/30 focus:border-nexus-500/50 focus:outline-none"
            aria-label="Search"
          />
        </div>
      </form>
      <div className="flex items-center gap-4 text-sm">
        <span className="font-mono text-white/40">{time}</span>
        <button
          onClick={() => {
            const next: ThemeMode = isDark ? 'light' : 'dark';
            setTheme(next);
          }}
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
          aria-label="Toggle theme"
          title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-nexus-500 to-fuchsia-500" />
          <div className="text-xs">
            <div className="font-medium">Gateway</div>
            <div className="text-white/40">Local</div>
          </div>
        </div>
      </div>
    </header>
  );
}
