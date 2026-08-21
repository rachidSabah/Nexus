/**
 * Caveman Compression adapter (honest external-engine hook).
 *
 * Caveman (https://github.com/wilpel/caveman-compression) is a Python CLI with
 * three modes:
 *   - NLP  (caveman_compress_nlp.py)  : free, offline, ~15-30%, rule-based
 *   - MLM  (caveman_compress_mlm.py)  : free, offline, ~20-30%, local RoBERTa
 *   - LLM  (caveman_compress.py)      : 40-58%, needs an OpenAI API key
 *
 * There is NO npm package and NO REST endpoint — it is invoked as a subprocess.
 * Nexus does NOT bundle Python or ship any key. This factory wraps the CLI in
 * the ExternalCompressorHandle contract so an operator who HAS the tool installed
 * can register it. Nexus measures the REAL before/after and reports it — never a
 * fabricated percentage. If the CLI is missing, the registry treats it as a
 * no-op (original text returned) so a prompt is never corrupted.
 *
 * Usage:
 *   import { externalCompressors, createCavemanCompressor } from '@anx/token-efficiency';
 *   externalCompressors.register(createCavemanCompressor({ mode: 'nlp', cliDir: '/opt/caveman' }));
 *   // then the pipeline/surfaces can call externalCompressors.run('caveman', text)
 */

import { spawn } from 'node:child_process';

export type CavemanMode = 'nlp' | 'mlm' | 'llm';

const CLI_MODULE: Record<CavemanMode, string> = {
  nlp: 'caveman_compress_nlp.py',
  mlm: 'caveman_compress_mlm.py',
  llm: 'caveman_compress.py',
};

export interface CavemanCompressorOptions {
  /** Compression mode. Default 'nlp' (free, offline, no key). */
  mode?: CavemanMode;
  /** Directory containing the Caveman CLI scripts. Required. */
  cliDir: string;
  /** Language hint for NLP mode (e.g. 'en', 'es'). Default 'en'. */
  language?: string;
  /** Extra env for the subprocess (e.g. OPENAI_API_KEY for LLM mode). */
  env?: NodeJS.ProcessEnv;
  /** Subprocess timeout in ms. Default 30000. */
  timeoutMs?: number;
}

function runCli(opts: CavemanCompressorOptions, text: string): Promise<string> {
  const mode = opts.mode ?? 'nlp';
  const module = CLI_MODULE[mode];
  const script = `${opts.cliDir.replace(/[/\\]$/, '')}/${module}`;
  return new Promise<string>((resolve, reject) => {
    const proc = spawn('python3', [script, 'compress', '-'], {
      env: { ...process.env, ...(opts.env ?? {}) },
      timeout: opts.timeoutMs ?? 30_000,
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`caveman ${mode} exited ${code}: ${err.slice(0, 300)}`));
      else resolve(out.trim());
    });
    proc.stdin.write(text);
    proc.stdin.end();
  });
}

/**
 * Build an ExternalCompressorHandle for Caveman. The returned `compress` throws
 * if the CLI is absent/misconfigured — the ExternalCompressorRegistry catches
 * that and returns the original text (no corruption, no fake saving).
 */
export function createCavemanCompressor(opts: CavemanCompressorOptions) {
  const mode = opts.mode ?? 'nlp';
  return {
    name: 'caveman',
    description: `Caveman Compression (${mode} mode, operator-installed CLI at ${opts.cliDir})`,
    compress(text: string): Promise<string> {
      return runCli(opts, text);
    },
  };
}
