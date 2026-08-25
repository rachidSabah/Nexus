'use client';

import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Layers,
  RefreshCw,
  Settings2,
  TrendingDown,
  Zap,
} from 'lucide-react';
import { useCallback, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';

// ── Engine catalogue ─────────────────────────────────────────────────────────

type EngineName =
  | 'minify'
  | 'dedupe_lines'
  | 'collapse_arrays'
  | 'elide_middle'
  | 'session_dedup'
  | 'headroom';

const ENGINE_META: Record<
  EngineName,
  { label: string; desc: string; color: string; bg: string }
> = {
  minify: {
    label: 'Minify',
    desc: 'Collapse whitespace & strip standalone comments',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500',
  },
  dedupe_lines: {
    label: 'Dedupe Lines',
    desc: 'Collapse 3+ identical consecutive lines to ×N marker',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500',
  },
  collapse_arrays: {
    label: 'Collapse Arrays',
    desc: 'Compress repeated JSON array items to a compact form',
    color: 'text-violet-400',
    bg: 'bg-violet-500',
  },
  elide_middle: {
    label: 'Elide Middle',
    desc: 'Keep head + tail, elide oversized middle blocks',
    color: 'text-amber-400',
    bg: 'bg-amber-500',
  },
  session_dedup: {
    label: 'Session Dedup',
    desc: 'Cross-turn deduplication — removes blocks already seen in prior turns',
    color: 'text-pink-400',
    bg: 'bg-pink-500',
  },
  headroom: {
    label: 'Headroom',
    desc: 'Columnar compaction of homogeneous JSON-array payloads',
    color: 'text-sky-400',
    bg: 'bg-sky-500',
  },
};

const ALL_ENGINES: EngineName[] = [
  'minify',
  'dedupe_lines',
  'collapse_arrays',
  'elide_middle',
  'session_dedup',
  'headroom',
];

// ── Types ────────────────────────────────────────────────────────────────────

interface EngineRow {
  engine: EngineName;
  charsSaved: number;
  tokensSaved: number;
  pct: number;
}

interface PipelinePreview {
  originalChars: number;
  finalChars: number;
  originalTokens: number;
  finalTokens: number;
  totalCharsSaved: number;
  totalTokensSaved: number;
  savingsPct: number;
  engines: EngineRow[];
  compressedText: string;
}

// ── Sample content ────────────────────────────────────────────────────────────

const SAMPLE = `Building project...
npm warn deprecated left-pad@1.0.0
npm warn deprecated left-pad@1.0.0
npm warn deprecated left-pad@1.0.0
npm warn deprecated left-pad@1.0.0
compiling src/index.ts
compiling src/app.ts
compiling src/util.ts
[
  { "id": 1, "name": "a" },
  { "id": 1, "name": "a" },
  { "id": 1, "name": "a" },
  { "id": 1, "name": "a" },
  { "id": 1, "name": "a" }
]
// TODO: cleanup
step 1
step 2
step 3 (repeated log lines...)`;

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CompressionLabPage() {
  // ── Input state ────────────────────────────────────────────────────────────
  const [text, setText] = useState(SAMPLE);
  const [priorContent, setPriorContent] = useState('');
  const [showPrior, setShowPrior] = useState(false);

  // ── Options state ──────────────────────────────────────────────────────────
  const [enabledEngines, setEnabledEngines] = useReducer(
    (prev: Set<EngineName>, engine: EngineName): Set<EngineName> => {
      const next = new Set(prev);
      if (next.has(engine)) next.delete(engine);
      else next.add(engine);
      return next;
    },
    new Set<EngineName>(ALL_ENGINES),
  );
  const [elideThreshold, setElideThreshold] = useState(2000);
  const [keepComments, setKeepComments] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // ── Debounced request body ─────────────────────────────────────────────────
  const [debounced, setDebounced] = useState({ text: SAMPLE, priorContent: '', engines: ALL_ENGINES, elideThreshold: 2000, keepComments: false });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDebounce = useCallback(
    (patch: Partial<typeof debounced>) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        setDebounced((prev) => ({ ...prev, ...patch }));
      }, 250);
    },
    [],
  );

  const onTextChange = (v: string) => {
    setText(v);
    scheduleDebounce({ text: v });
  };

  const onPriorChange = (v: string) => {
    setPriorContent(v);
    scheduleDebounce({ priorContent: v });
  };

  const onEngineToggle = (engine: EngineName) => {
    setEnabledEngines(engine);
    const next = new Set(enabledEngines);
    if (next.has(engine)) next.delete(engine);
    else next.add(engine);
    scheduleDebounce({ engines: ALL_ENGINES.filter((e) => next.has(e)) });
  };

  const onElideChange = (v: number) => {
    setElideThreshold(v);
    scheduleDebounce({ elideThreshold: v });
  };

  const onKeepCommentsChange = (v: boolean) => {
    setKeepComments(v);
    scheduleDebounce({ keepComments: v });
  };

  // ── SWR fetch ──────────────────────────────────────────────────────────────
  const swrKey = debounced.text
    ? ['/api/v1/compression/pipeline-preview', JSON.stringify(debounced)]
    : null;

  const { data, isLoading } = useSWR<PipelinePreview>(
    swrKey,
    ([url]: [string]) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: debounced.text,
          engines: debounced.engines,
          elideThreshold: debounced.elideThreshold,
          keepComments: debounced.keepComments,
          priorContent: debounced.priorContent || undefined,
        }),
      }).then((r) => r.json()),
    { refreshInterval: 0, revalidateOnFocus: false },
  );

  const maxPct = Math.max(1, ...(data?.engines.map((e) => e.pct) ?? [1]));

  // ── Copy / Apply ───────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!data?.compressedText) return;
    navigator.clipboard?.writeText(data.compressedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const handleApply = () => {
    if (!data?.compressedText) return;
    onTextChange(data.compressedText);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 relative pb-12">
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />

      {/* Header */}
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-400 backdrop-blur-md mb-2">
            <Layers className="h-3.5 w-3.5 animate-pulse" /> Live Token Compression
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <TrendingDown className="h-8 w-8 text-violet-400" /> Compression Lab
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Nexus runs a stacked compression pipeline on{' '}
            <span className="text-violet-300">your actual content</span> and shows the real, measured
            savings per engine — live, not a static claim. All 6 engines, fully interactive.
          </p>
        </div>
      </div>

      {/* Options panel toggle */}
      <div>
        <button
          onClick={() => setShowOptions((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-white/70 hover:border-violet-500/40 hover:text-white transition-colors"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Pipeline Options
          {showOptions ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {showOptions && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl space-y-5">
            {/* Engine toggles */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/50 mb-3">
                Active Engines
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {ALL_ENGINES.map((engine) => {
                  const meta = ENGINE_META[engine];
                  const active = enabledEngines.has(engine);
                  return (
                    <button
                      key={engine}
                      onClick={() => onEngineToggle(engine)}
                      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                        active
                          ? 'border-violet-500/40 bg-violet-500/10'
                          : 'border-white/5 bg-white/[0.02] opacity-50'
                      }`}
                    >
                      <span
                        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${active ? meta.bg : 'bg-white/20'}`}
                      />
                      <div>
                        <p className={`text-xs font-semibold ${active ? meta.color : 'text-white/40'}`}>
                          {meta.label}
                        </p>
                        <p className="text-[10px] text-white/30 leading-tight mt-0.5">{meta.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Elide threshold slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  Elide Threshold
                </p>
                <span className="font-mono text-xs text-amber-400">{elideThreshold.toLocaleString()} chars</span>
              </div>
              <input
                type="range"
                min={500}
                max={8000}
                step={100}
                value={elideThreshold}
                onChange={(e) => onElideChange(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
              <div className="flex justify-between text-[10px] text-white/25 mt-1">
                <span>500 — most aggressive</span>
                <span>8 000 — most lenient</span>
              </div>
            </div>

            {/* Keep comments toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white/70">Preserve Comments</p>
                <p className="text-[10px] text-white/30">Keep <code className="text-white/40">// …</code> and <code className="text-white/40"># …</code> lines instead of stripping them</p>
              </div>
              <button
                onClick={() => onKeepCommentsChange(!keepComments)}
                className={`relative h-5 w-9 rounded-full transition-colors ${keepComments ? 'bg-violet-500' : 'bg-white/10'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${keepComments ? 'translate-x-4' : 'translate-x-0.5'}`}
                />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* LEFT — Input */}
        <div className="flex flex-col gap-4">
          {/* Source content */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl flex-1">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Source content
              </span>
              <span className="text-[11px] text-white/40">{text.length.toLocaleString()} chars</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              spellCheck={false}
              className="h-72 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white/90 outline-none focus:border-violet-500/50"
              placeholder="Paste a verbose log, diff, tool output, or prompt…"
            />
          </div>

          {/* Prior session content (for session_dedup) */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl">
            <button
              onClick={() => setShowPrior((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wider text-white/50 hover:text-white/70 transition-colors"
            >
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-pink-500" />
                Prior Session Content
                <span className="ml-1 rounded-full border border-pink-500/30 bg-pink-500/10 px-2 py-0.5 text-[10px] text-pink-400">
                  seeds session_dedup
                </span>
              </span>
              {showPrior ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {showPrior && (
              <>
                <p className="mt-2 text-[10px] text-white/30 leading-relaxed">
                  Paste content from an earlier turn in the same conversation. Paragraph blocks of 64+
                  chars that appear in both inputs will be replaced by a compact dedup marker.
                </p>
                <textarea
                  value={priorContent}
                  onChange={(e) => onPriorChange(e.target.value)}
                  spellCheck={false}
                  className="mt-3 h-32 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white/70 outline-none focus:border-pink-500/40"
                  placeholder="Paste prior turn text here…"
                />
              </>
            )}
          </div>
        </div>

        {/* RIGHT — Results */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl flex flex-col gap-5">
          {/* Headline savings */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Live savings
              </span>
              {isLoading && (
                <span className="flex items-center gap-1 text-[11px] text-violet-300/60">
                  <RefreshCw className="h-3 w-3 animate-spin" /> computing…
                </span>
              )}
            </div>

            <div className="flex items-end gap-3">
              <div className="text-5xl font-black tracking-tight text-emerald-300">
                {data?.savingsPct ?? 0}%
              </div>
              <div className="pb-1 text-xs text-white/50">
                saved
                <br />
                {data
                  ? `${data.totalCharsSaved.toLocaleString()} chars · ~${data.totalTokensSaved.toLocaleString()} tokens`
                  : '—'}
              </div>
            </div>

            {data && (
              <div className="mt-2 flex items-center gap-4 text-[11px] text-white/40">
                <span>{data.originalTokens.toLocaleString()} tokens in</span>
                <span className="text-emerald-400">→ {data.finalTokens.toLocaleString()} tokens out</span>
              </div>
            )}
          </div>

          {/* Per-engine breakdown */}
          <div className="space-y-3">
            {data?.engines.map((e) => {
              const meta = ENGINE_META[e.engine] ?? {
                label: e.engine,
                desc: '',
                color: 'text-white/60',
                bg: 'bg-violet-500',
              };
              return (
                <div key={e.engine}>
                  <div className="flex items-center justify-between text-xs">
                    <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                    <div className="flex items-center gap-3 text-white/40">
                      <span className="font-mono">
                        {e.charsSaved > 0 ? `-${e.charsSaved.toLocaleString()} chars` : 'no change'}
                      </span>
                      <span className="font-mono font-semibold text-white/60">
                        {e.pct > 0 ? `-${e.pct}%` : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                    <div
                      className={`h-full ${meta.bg} transition-all duration-300`}
                      style={{ width: e.pct > 0 ? `${(e.pct / maxPct) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
              );
            })}
            {!data && !isLoading && (
              <div className="text-xs text-white/30">Type or paste content to see per-engine savings…</div>
            )}
          </div>

          {/* Compressed output + action buttons */}
          {data?.compressedText && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  Compressed output
                </span>
                <div className="flex items-center gap-2">
                  {/* Copy */}
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:border-violet-500/40 hover:text-white transition-colors"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </button>

                  {/* Apply — replaces source with compressed output */}
                  <button
                    onClick={handleApply}
                    className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  >
                    <TrendingDown className="h-3 w-3" />
                    Use compressed
                  </button>
                </div>
              </div>
              <pre className="max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-white/80 whitespace-pre-wrap break-words">
                {data.compressedText}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Footer disclaimer */}
      <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-violet-200/70">
        <Zap className="h-4 w-4 shrink-0 text-violet-400" />
        All numbers are measured transformations of your input (chars ÷ 4 token estimate). No invented
        percentages — what you see is exactly what the pipeline removed.
      </div>
    </div>
  );
}
