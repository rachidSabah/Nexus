'use client';

import { useEffect, useState } from 'react';
import { Moon, Search, Sun } from 'lucide-react';

export function Topbar() {
  const [time, setTime] = useState<string>('');
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-black/20 px-8">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            type="search"
            placeholder="Search providers, requests, plugins…"
            className="h-9 w-80 rounded-lg border border-white/5 bg-white/[0.02] pl-8 pr-3 text-sm placeholder:text-white/30 focus:border-nexus-500/50 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <span className="font-mono text-white/40">{time}</span>
        <button
          onClick={() => setDark(!dark)}
          className="rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
          aria-label="Toggle theme"
        >
          {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-nexus-500 to-fuchsia-500" />
          <div className="text-xs">
            <div className="font-medium">admin</div>
            <div className="text-white/40">admin role</div>
          </div>
        </div>
      </div>
    </header>
  );
}
