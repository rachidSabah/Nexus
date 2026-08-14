'use client';

import { Workflow, Plus, Trash2, GripVertical, ArrowRight, Save, Sparkles, Cpu } from 'lucide-react';
import { useState } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WorkflowStep {
  name: string;
  agent?: string;
  task: string;
  condition?: string;
}

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  version: number;
  steps: WorkflowStep[];
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

export default function WorkflowEditorPage() {
  const { data: workflows } = useSWR<readonly WorkflowDef[]>('/api/v1/workflows', fetcher, { refreshInterval: 10000 });
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [workflowName, setWorkflowName] = useState('');
  const [workflowDesc, setWorkflowDesc] = useState('');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const selected = workflows?.find((w) => w.id === selectedId);

  function loadWorkflow(w: WorkflowDef) {
    setSelectedId(w.id);
    setSteps([...w.steps]);
    setWorkflowName(w.name);
    setWorkflowDesc(w.description);
  }

  function addStep() {
    setSteps([...steps, { name: `Step ${steps.length + 1}`, task: '' }]);
  }

  function removeStep(index: number) {
    setSteps(steps.filter((_, i) => i !== index));
  }

  function updateStep(index: number, field: keyof WorkflowStep, value: string) {
    setSteps(steps.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function reorderStep(from: number, to: number) {
    const newSteps = [...steps];
    const [moved] = newSteps.splice(from, 1);
    newSteps.splice(to, 0, moved!);
    setSteps(newSteps);
  }

  async function saveWorkflow() {
    if (!workflowName || steps.length === 0) {
      setSaveMsg('Workflow title and at least 1 step are required');
      return;
    }
    const body = {
      id: selectedId ?? `custom-${Date.now().toString(36)}`,
      name: workflowName,
      description: workflowDesc,
      steps,
      inputs: {},
      outputs: {},
    };
    const r = await fetch('/api/v1/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setSaveMsg(`Successfully saved workflow [${body.id}]`);
    } else {
      const errBody = await r.json().catch(() => ({ error: { message: 'Failed to save' } }));
      setSaveMsg(`Error: ${errBody?.error?.message ?? r.statusText}`);
    }
  }

  function newWorkflow() {
    setSelectedId(undefined);
    setSteps([]);
    setWorkflowName('');
    setWorkflowDesc('');
    setSaveMsg(null);
  }

  return (
    <div className="space-y-8 relative pb-12 w-full max-w-full overflow-x-hidden">
      {/* Background Cyber Accents */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-nexus-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-80 w-80 rounded-full bg-cyan-600/10 blur-[100px]" />

      {/* Cyber Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-nexus-500/30 bg-nexus-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-nexus-400 backdrop-blur-md mb-2">
            <Sparkles className="h-3.5 w-3.5 animate-pulse text-nexus-300" /> Interactive Workflow Canvas
          </div>
          <h1 className="flex items-center gap-3 text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <Workflow className="h-8 w-8 text-nexus-400" />
            Visual Workflow Builder & Editor
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-white/60 max-w-2xl">
            Construct multi-agent workflows by ordering tasks, assigning subagents, setting conditions, and compiling to gateway execution engine.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Workflow Selection Panel */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl lg:col-span-1">
          <div className="flex items-center justify-between border-b border-white/5 pb-3 mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-white/70">Workflows Library</h2>
            <button
              onClick={newWorkflow}
              className="flex items-center gap-1 rounded-xl bg-nexus-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition hover:bg-nexus-500"
            >
              <Plus className="h-3.5 w-3.5" /> Create New
            </button>
          </div>
          <div className="space-y-2">
            {(workflows ?? []).map((w) => (
              <button
                key={w.id}
                onClick={() => loadWorkflow(w)}
                className={`w-full rounded-xl p-3.5 text-left border transition ${
                  selectedId === w.id
                    ? 'border-nexus-500/50 bg-nexus-500/10 shadow-md'
                    : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.05]'
                }`}
              >
                <div className="text-sm font-bold text-white">{w.name}</div>
                <div className="mt-1 text-xs text-white/40 font-mono">
                  v{w.version} · {w.steps.length} step{w.steps.length !== 1 ? 's' : ''}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor Form */}
        <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-black/40 p-5 sm:p-6 backdrop-blur-xl lg:col-span-2 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Cpu className="h-4 w-4 text-emerald-400" /> {selectedId ? `Editing: ${selected?.name ?? selectedId}` : 'Design New Workflow'}
            </h2>
            <button
              onClick={saveWorkflow}
              className="rounded-xl bg-gradient-to-r from-nexus-600 to-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:scale-[1.02] active:scale-95 flex items-center gap-1.5"
            >
              <Save className="h-3.5 w-3.5" /> Save & Deploy Pipeline
            </button>
          </div>

          {saveMsg && (
            <div className="rounded-xl border border-nexus-500/30 bg-nexus-500/10 p-3 text-xs text-nexus-300 font-mono">
              {saveMsg}
            </div>
          )}

          {/* Name + description */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Workflow Title</label>
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="Autonomous Code Audit Pipeline"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-white/70 mb-1">Description</label>
              <input
                type="text"
                value={workflowDesc}
                onChange={(e) => setWorkflowDesc(e.target.value)}
                placeholder="Multi-stage security and refactoring pipeline"
                className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs text-white placeholder:text-white/30 focus:border-nexus-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">Workflow Steps ({steps.length})</h3>
            {steps.map((step, i) => (
              <div
                key={i}
                className="rounded-xl border border-white/10 bg-black/40 p-4 transition hover:border-nexus-500/30"
                draggable
                onDragStart={() => setDraggedIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedIndex !== null && draggedIndex !== i) {
                    reorderStep(draggedIndex, i);
                    setDraggedIndex(null);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 cursor-grab text-white/40 hover:text-white" />
                    <span className="text-xs font-bold text-nexus-300">Step {i + 1}</span>
                  </div>
                  <button
                    onClick={() => removeStep(i)}
                    className="rounded-lg p-1.5 text-white/40 transition hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[10px] text-white/50 mb-1">Step Name</label>
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => updateStep(i, 'name', e.target.value)}
                      className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/50 mb-1">Target Agent ID (Optional)</label>
                    <input
                      type="text"
                      value={step.agent ?? ''}
                      onChange={(e) => updateStep(i, 'agent', e.target.value)}
                      placeholder="auto"
                      className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white placeholder:text-white/30 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-white/50 mb-1">Condition Expression (Optional)</label>
                    <input
                      type="text"
                      value={step.condition ?? ''}
                      onChange={(e) => updateStep(i, 'condition', e.target.value)}
                      placeholder="inputs.x > 0"
                      className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs text-white placeholder:text-white/30 font-mono"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[10px] text-white/50 mb-1">Task Prompt / Instruction</label>
                  <textarea
                    value={step.task}
                    onChange={(e) => updateStep(i, 'task', e.target.value)}
                    placeholder="Describe step instruction..."
                    rows={2}
                    className="w-full rounded-lg border border-white/10 bg-white/[0.03] p-2.5 text-xs text-white placeholder:text-white/30"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add step button */}
          <button
            onClick={addStep}
            className="w-full rounded-xl border border-dashed border-white/20 p-3.5 text-xs font-semibold text-white/60 transition hover:border-nexus-500/50 hover:bg-nexus-500/10 hover:text-nexus-300"
          >
            <Plus className="mr-1.5 inline h-4 w-4" /> Add Next Workflow Step
          </button>

          {/* Visual flow preview */}
          {steps.length > 0 && (
            <div className="mt-6 border-t border-white/5 pt-4">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-white/70">Canvas Flow Preview</h3>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center min-w-[130px]">
                      <div className="text-xs font-bold text-nexus-300">{step.name}</div>
                      <div className="mt-1 text-[10px] text-white/40 font-mono">Agent: {step.agent ?? 'auto'}</div>
                    </div>
                    {i < steps.length - 1 && (
                      <ArrowRight className="mx-2 h-4 w-4 text-white/30" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

