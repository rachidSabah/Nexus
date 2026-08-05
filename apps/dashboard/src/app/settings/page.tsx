'use client';

import { Settings } from 'lucide-react';
export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-white/50">Gateway configuration and runtime parameters.</p>
      </div>
      <div className="card flex items-center gap-4">
        <Settings className="h-8 w-8 text-nexus-400" />
        <div>
          <div className="font-medium">Configuration</div>
          <div className="text-sm text-white/50">
            Edit <code>agent-nexus.config.json</code> at the gateway and restart, or use the CLI <code>anx config</code> command.
          </div>
        </div>
      </div>
    </div>
  );
}
