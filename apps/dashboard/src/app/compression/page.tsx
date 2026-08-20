'use client';

import { Layers, Zap, TrendingDown, Copy, Check } from 'lucide-react';
import { useCallback, useState } from 'react';
import useSWR from 'swr';

interface EngineRow {
  engine: string;
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

const ENGINE_LABELS: Record<string, string> = {
  minify: 'Minify (whitespace + comments)',
  dedupe_lines: 'Dedupe repeated lines',
  collapse_arrays: 'Collapse repeated arrays',
  elide_middle: 'Elide oversized middle',
};

const ENGINE_COLORS: Record<string, string> = {
  minify: 'bg-cyan-500',
  dedupe_lines: 'bg-emerald-500',
  collapse_arrays: 'bg-violet-500',
  elide_middle: 'bg-amber-500',
};

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

export default function CompressionLabPage() {
  const [text, setText] = useState(SAMPLE);
  const [debounced, setDebounced] = useState(SAMPLE);
  const [copied, setCopied] = useState(false);

  // debounce input → live preview
  const onType = useCallback((v: string) => {
    setText(v);
    const t = setTimeout(() => setDebounced(v), 250);
    return () => clearTimeout(t);
  }, []);

  const { data, isLoading } = useSWR<PipelinePreview>(
    debounced ? '/api/v1/compression/pipeline-preview' : null,
    (url: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: debounced }),
      }).then((r) => r.json()),
    { refreshInterval: 0, revalidateOnFocus: false }
  );

  const maxPct = Math.max(1, ...(data?.engines.map((e) => e.pct) ?? [1]));

  return (
    <div className="space-y-8 relative pb-12">
      <div className="pointer-events-none absolute -top-10 -right-10 h-96 w-96 rounded-full bg-violet-600/10 blur-[120px]" />

      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center border-b border-white/10 pb-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-violet-400 backdrop-blur-md mb-2">
            <Layers className="h-3.5 w-3.5 animate-pulse" /> Live Token Compression
          </div>
          <h1 className="flex items-center gap-3 text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
            <TrendingDown className="h-8 w-8 text-violet-400" /> Compression Lab
          </h1>
          <p className="mt-1 text-sm text-white/60 max-w-2xl">
            Nexus runs a stacked compression pipeline on <span className="text-violet-300">your actual content</span> and shows the
            real, measured savings per engine — live, not a static claim. This is the compression analytics OmniRoute headlines, made
            interactive.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Source content</span>
            <span className="text-[11px] text-white/40">{text.length} chars</span>
          </div>
          <textarea
            value={text}
            onChange={(e) => onType(e.target.value)}
            spellCheck={false}
            className="h-80 w-full resize-none rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white/90 outline-none focus:border-violet-500/50"
            placeholder="Paste a verbose log, diff, or tool output…"
          />
        </div>

        {/* Live results */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Live savings</span>
            {isLoading && <span className="text-[11px] text-violet-300/60">computing…</span>}
          </div>

          <div className="flex items-end gap-3">
            <div className="text-5xl font-black tracking-tight text-emerald-300">{data?.savingsPct ?? 0}%</div>
            <div className="pb-1 text-xs text-white/50">
              saved
              <br />
              {data ? `${data.totalCharsSaved.toLocaleString()} chars · ~${data.totalTokensSaved.toLocaleString()} tokens` : '—'}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {data?.engines.map((e) => (
              <div key={e.engine}>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70">{ENGINE_LABELS[e.engine] ?? e.engine}</span>
                  <span className="font-mono text-white/50">-{e.pct}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full ${ENGINE_COLORS[e.engine] ?? 'bg-violet-500'} transition-all duration-300`}
                    style={{ width: `${(e.pct / maxPct) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {!data && <div className="text-xs text-white/30">Type content to see per-engine savings…</div>}
          </div>

          {data?.compressedText && (
            <div className="mt-5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-white/50">Compressed output</span>
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(data.compressedText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  className="flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/60 hover:border-violet-500/40"
                >
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-white/80">
                {data.compressedText}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-violet-200/70">
        <Zap className="h-4 w-4 text-violet-400" />
        All numbers are measured transformations of your input (chars/4 token estimate). No invented percentages — what you see is what
        the pipeline actually removed.
      </div>
    </div>
  );
}
