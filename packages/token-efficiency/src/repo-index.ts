/**
 * ───────────────────────────────────────────────────────────────────────────
 * Repository Context Index — spec §20–§21.
 *
 * §20: a lightweight, deterministic index of repository context (files,
 *      symbols, first-level dependencies) built without an LLM.
 * §21: retrieval prioritizes files touched by the working tree (git),
 *      then recency / size / extension relevance, capped by a token budget.
 *
 * Everything here is mechanical: no heuristics that can silently mislead —
 * symbol counts per file are capped and reported, oversized files are marked
 * as coarse (symbols/deps not resolved) so callers know what they are getting.
 * ───────────────────────────────────────────────────────────────────────────
 */

import fs from 'node:fs';
import path from 'node:path';

/** Directories never indexed (build / vendored / cache noise). */
const IGNORED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.next',
  '.turbo', '.cache', '.nuxt', 'vendor', '__pycache__', '.venv', 'venv', 'target',
]);

/** Files never indexed (binaries, lockfiles, minified artifacts). */
const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.woff', '.woff2', '.ttf',
  '.zip', '.gz', '.tar', '.7z', '.jar', '.exe', '.dll', '.so', '.dylib', '.bin',
  '.lock', '.map', '.min.js', '.min.css',
]);

/** Files never indexed even when the extension looks code-like (lockfiles). */
const IGNORED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'deno.lock',
]);

/** Extension → language label (display only; indexing uses shared regexes). */
const LANGUAGE_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript-react', '.js': 'javascript', '.jsx': 'javascript-react',
  '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python', '.rs': 'rust', '.go': 'go',
  '.java': 'java', '.kt': 'kotlin', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
  '.cs': 'csharp', '.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.toml': 'toml',
  '.yaml': 'yaml', '.yml': 'yaml', '.json': 'json', '.md': 'markdown', '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.ps1': 'powershell', '.css': 'css', '.scss': 'scss',
  '.html': 'html', '.vue': 'vue', '.svelte': 'svelte',
};

const CODE_EXTENSIONS = new Set(Object.keys(LANGUAGE_BY_EXT));

/** Cap of unique symbols reported per file (protection against generated blobs). */
const MAX_SYMBOLS_PER_FILE = 40;
/** Files larger than this are indexed coarsely (no symbols/deps resolved). */
const MAX_DENSE_SCAN_BYTES = 2 * 1024 * 1024;
/** Hard cap of files indexed per scan. */
const MAX_FILES_PER_SCAN = 10_000;

export interface RepoFileInfo {
  /** Path relative to the scan root, forward slashes. */
  path: string;
  extension: string;
  sizeBytes: number;
  lineCount: number;
  mtimeMs: number;
  language: string | null;
  /** Capped symbol list (MAX_SYMBOLS_PER_FILE). Empty when coarse-scanned. */
  symbols: string[];
  /** Local first-level imports/requires (relative or /-rooted). */
  deps: string[];
  /** True when the file was too large for a dense (symbols/deps) scan. */
  coarse: boolean;
}

export interface RepoScanResult {
  root: string;
  files: RepoFileInfo[];
  skippedDirs: number;
  skippedFiles: number;
  scannedAt: number;
}

export interface RankedFile extends RepoFileInfo {
  rank: number;
  changed: boolean;
  /** Size/4 — a coarse token estimate for budget capping. */
  estimatedTokens: number;
}

export interface RepoSelection {
  files: RankedFile[];
  totalTokens: number;
  totalFiles: number;
  /** Files that ranked but were cut by the token/file caps. */
  droppedForBudget: number;
}

const SYMBOL_RE =
  /\b(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|struct|trait|impl|def|const|let|var|func)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

const DEP_RE = /(?:from\s+|import\s+|require\(\s*)['"]([^'"]+)['"]/g;

const isCodeFile = (ext: string): boolean => CODE_EXTENSIONS.has(ext);

function scanFile(abs: string, rel: string): RepoFileInfo | null {
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  if (IGNORED_EXTENSIONS.has(ext) || IGNORED_FILES.has(base)) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  // Files > 8 MB are skipped outright (indexing them buys nothing);
  // 2–8 MB files are indexed coarsely (see `coarse` below).
  const info: RepoFileInfo = {
    path: rel.split(path.sep).join('/'),
    extension: ext === '' ? path.extname(abs).toLowerCase() : ext,
    sizeBytes: stat.size,
    lineCount: 0,
    mtimeMs: stat.mtimeMs,
    language: LANGUAGE_BY_EXT[ext] ?? null,
    symbols: [],
    deps: [],
    coarse: false,
  };
  if (!isCodeFile(ext) || stat.size > MAX_DENSE_SCAN_BYTES) {
    info.coarse = stat.size > MAX_DENSE_SCAN_BYTES;
    return info;
  }
  let content: string;
  try {
    content = fs.readFileSync(abs, 'utf8');
  } catch {
    info.coarse = true;
    return info;
  }
  info.lineCount = content.split('\n').length;
  const symbols = new Set<string>();
  const deps = new Set<string>();
  for (const m of content.matchAll(SYMBOL_RE)) {
    const name = m[1];
    if (name !== undefined) symbols.add(name);
    if (symbols.size >= MAX_SYMBOLS_PER_FILE) break;
  }
  for (const m of content.matchAll(DEP_RE)) {
    const dep = m[1];
    if (dep !== undefined && (dep.startsWith('.') || dep.startsWith('/'))) {
      deps.add(dep);
    }
  }
  info.symbols = [...symbols].slice(0, MAX_SYMBOLS_PER_FILE);
  info.deps = [...deps].slice(0, 80);
  return info;
}

/** Walk `root` (depth-first, IGNORED_DIRS pruned) and index files. */
export function scanRepository(root: string): RepoScanResult {
  const files: RepoFileInfo[] = [];
  let skippedDirs = 0;
  let skippedFiles = 0;
  const walk = (dir: string, relDir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (files.length >= MAX_FILES_PER_SCAN) return;
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          skippedDirs += 1;
          continue;
        }
        walk(abs, rel);
      } else if (entry.isFile()) {
        const info = scanFile(abs, rel);
        if (info === null) {
          skippedFiles += 1;
        } else {
          files.push(info);
        }
      }
    }
  };
  walk(root, '');
  return { root, files, skippedDirs, skippedFiles, scannedAt: Date.now() };
}

/** Rank index entries: changed files first, then recency / extension / size. */
export function rankRepository(
  index: RepoScanResult,
  changedFiles: string[],
): RankedFile[] {
  const changed = new Set(changedFiles.map((p) => p.split(path.sep).join('/')));
  const now = Date.now();
  const ranked = index.files.map((f) => {
    const isChanged = changed.has(f.path);
    let weight = 0;
    if (isChanged) weight += 100_000;
    // Recency: files touched within the last 7 days gain up to +500.
    const ageDays = (now - f.mtimeMs) / 86_400_000;
    if (ageDays < 7) weight += Math.round(500 * (1 - ageDays / 7));
    // Extension relevance: code yes, docs/markup neutral, generated no.
    if (CODE_EXTENSIONS.has('.' + f.extension)) weight += 120;
    else if (f.extension === '.md') weight += 40;
    // Oversized or coarse files are penalized (low information density).
    if (f.coarse || f.sizeBytes > 1_500_000) weight -= 300;
    // Deterministic tiebreak before alphabetical sort.
    return {
      ...f,
      rank: 0,
      changed: isChanged,
      estimatedTokens: Math.max(1, Math.round(f.sizeBytes / 4)),
      _weight: weight,
    };
  });
  ranked.sort((a, b) => {
    if (a._weight !== b._weight) return b._weight - a._weight;
    return a.path.localeCompare(b.path);
  });
  return ranked.map((r, i) => {
    const { _weight: _omit, ...rest } = r;
    void _omit;
    return { ...rest, rank: i + 1 };
  });
}

/** Pick the top-ranked files until the file/token caps are met (§21). */
export function selectRepositoryContext(
  ranked: RankedFile[],
  options: { maxFiles?: number; maxTokens?: number } = {},
): RepoSelection {
  const maxFiles = options.maxFiles ?? 25;
  const maxTokens = options.maxTokens ?? 60_000;
  const files: RankedFile[] = [];
  let totalTokens = 0;
  let droppedForBudget = 0;
  for (const file of ranked) {
    if (files.length >= maxFiles) {
      droppedForBudget += 1;
      continue;
    }
    if (totalTokens + file.estimatedTokens > maxTokens) {
      droppedForBudget += 1;
      continue;
    }
    files.push(file);
    totalTokens += file.estimatedTokens;
  }
  return { files, totalTokens, totalFiles: files.length, droppedForBudget };
}

/**
 * Parse `git status --porcelain` output WITHOUT running git — the caller
 * captures the stream (`git status --porcelain -z` or default) and we parse
 * it deterministically. Pure and unit-testable.
 */
export function parseGitPorcelain(
  output: string,
): Array<{ status: string; path: string }> {
  const result: Array<{ status: string; path: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    // XY<space>path (renames carry " -> " to the new path).
    const xy = line.slice(0, 2);
    let filePath = line.slice(3);
    const renameArrow = filePath.indexOf(' -> ');
    if (renameArrow !== -1) filePath = filePath.slice(renameArrow + 4);
    result.push({ status: xy.trim() === '' ? '??' : xy.trim(), path: filePath });
  }
  return result;
}