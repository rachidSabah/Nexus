'use client';

import { Layers } from 'lucide-react';
export default function WorkflowsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflows</h1>
        <p className="text-sm text-white/50">Visual editor for multi-agent orchestration workflows.</p>
      </div>
      <div className="card flex items-center gap-4">
        <Layers className="h-8 w-8 text-nexus-400" />
        <div>
          <div className="font-medium">Workflow editor</div>
          <div className="text-sm text-white/50">Drag-and-drop workflow composition is on the roadmap. Workflows can already be defined as code via <code>@anx/a2a</code>.</div>
        </div>
      </div>
    </div>
  );
}
