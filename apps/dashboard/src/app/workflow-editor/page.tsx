'use client';

import { Workflow, Plus, Trash2, GripVertical, ArrowRight, Save } from 'lucide-react';
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
      setSaveMsg('Name and at least one step are required');
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
      setSaveMsg(`Saved: ${body.id}`);
    } else {
      const errBody = await r.json().catch(() => ({ error: { message: 'Failed' } }));
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
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Workflow className="h-6 w-6 text-nexus-400" />
          Workflow Editor
        </h1>
        <p className="text-sm text-white/50">
          Create and edit multi-step agent workflows. Drag steps to reorder. Save to register with the workflow engine.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Workflow list */}
        <div className="card lg:col-span-1">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-white/80">Workflows</h2>
            <button
              onClick={newWorkflow}
              className="rounded-md bg-nexus-600/80 px-2 py-1 text-xs text-white hover:bg-nexus-500"
            >
              <Plus className="h-3 w-3" /> New
            </button>
          </div>
          <div className="space-y-2">
            {(workflows ?? []).map((w) => (
              <button
                key={w.id}
                onClick={() => loadWorkflow(w)}
                className={`w-full rounded-lg p-3 text-left transition ${selectedId === w.id ? 'bg-white/10' : 'bg-white/[0.02] hover:bg-white/5'}`}
              >
                <div className="text-sm font-medium">{w.name}</div>
                <div className="mt-0.5 text-xs text-white/40">
                  v{w.version} · {w.steps.length} steps
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Editor */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-white/80">
              {selectedId ? `Editing: ${selected?.name ?? selectedId}` : 'New Workflow'}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={saveWorkflow}
                className="rounded-md bg-nexus-600 px-3 py-1 text-xs font-medium text-white hover:bg-nexus-500"
              >
                <Save className="mr-1 inline h-3 w-3" /> Save
              </button>
            </div>
          </div>

          {saveMsg && <div className="mb-3 text-xs text-white/60">{saveMsg}</div>}

          {/* Name + description */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 mb-4">
            <label className="text-xs text-white/50">
              Name
              <input
                type="text"
                value={workflowName}
                onChange={(e) => setWorkflowName(e.target.value)}
                placeholder="My Workflow"
                className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-white/50">
              Description
              <input
                type="text"
                value={workflowDesc}
                onChange={(e) => setWorkflowDesc(e.target.value)}
                placeholder="What this workflow does"
                className="mt-1 h-8 w-full rounded-md border border-white/5 bg-white/[0.02] px-2 text-sm text-white"
              />
            </label>
          </div>

          {/* Steps */}
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div
                key={i}
                className="rounded-lg border border-white/5 bg-white/[0.02] p-3"
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
                <div className="flex items-center gap-2">
                  <GripVertical className="h-4 w-4 cursor-grab text-white/30" />
                  <span className="text-xs font-medium text-nexus-300">Step {i + 1}</span>
                  <button
                    onClick={() => removeStep(i)}
                    className="ml-auto rounded p-1 text-white/30 hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="text-[10px] text-white/40">
                    Name
                    <input
                      type="text"
                      value={step.name}
                      onChange={(e) => updateStep(i, 'name', e.target.value)}
                      className="mt-0.5 h-7 w-full rounded border border-white/5 bg-white/[0.02] px-2 text-xs text-white"
                    />
                  </label>
                  <label className="text-[10px] text-white/40">
                    Agent (optional)
                    <input
                      type="text"
                      value={step.agent ?? ''}
                      onChange={(e) => updateStep(i, 'agent', e.target.value)}
                      placeholder="auto"
                      className="mt-0.5 h-7 w-full rounded border border-white/5 bg-white/[0.02] px-2 text-xs text-white"
                    />
                  </label>
                  <label className="text-[10px] text-white/40">
                    Condition (optional)
                    <input
                      type="text"
                      value={step.condition ?? ''}
                      onChange={(e) => updateStep(i, 'condition', e.target.value)}
                      placeholder="inputs.x > 0"
                      className="mt-0.5 h-7 w-full rounded border border-white/5 bg-white/[0.02] px-2 text-xs text-white"
                    />
                  </label>
                </div>
                <label className="mt-2 block text-[10px] text-white/40">
                  Task / Prompt
                  <textarea
                    value={step.task}
                    onChange={(e) => updateStep(i, 'task', e.target.value)}
                    placeholder="Describe what this step should do..."
                    rows={2}
                    className="mt-0.5 w-full rounded border border-white/5 bg-white/[0.02] p-2 text-xs text-white"
                  />
                </label>
              </div>
            ))}
          </div>

          {/* Add step button */}
          <button
            onClick={addStep}
            className="mt-3 w-full rounded-lg border border-dashed border-white/10 p-3 text-sm text-white/40 transition hover:border-nexus-500/30 hover:text-white/60"
          >
            <Plus className="mr-1 inline h-4 w-4" /> Add Step
          </button>

          {/* Visual flow preview */}
          {steps.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Flow Preview</h3>
              <div className="flex items-center gap-2 overflow-x-auto pb-2">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center">
                    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center min-w-[120px]">
                      <div className="text-xs font-medium text-nexus-300">{step.name}</div>
                      <div className="mt-1 text-[10px] text-white/40">{step.agent ?? 'auto'}</div>
                    </div>
                    {i < steps.length - 1 && (
                      <ArrowRight className="mx-1 h-3 w-3 text-white/20" />
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
