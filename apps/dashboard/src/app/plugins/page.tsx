'use client';

import { Plug } from 'lucide-react';
export default function PluginsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plugins</h1>
        <p className="text-sm text-white/50">Manage gateway plugins and the extension marketplace.</p>
      </div>
      <div className="card flex items-center gap-4">
        <Plug className="h-8 w-8 text-nexus-400" />
        <div>
          <div className="font-medium">Plugin manager</div>
          <div className="text-sm text-white/50">Load, unload, and configure plugins. Coming soon — install plugins from the marketplace.</div>
        </div>
      </div>
    </div>
  );
}
