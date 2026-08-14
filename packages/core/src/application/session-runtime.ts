import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';

/**
 * Agent session runtime (Phase 17 §4). Abstraction over a concrete agent
 * execution backend (Hermes, OpenCode, …). Future agents are pluggable by
 * implementing this interface; the session layer never talks to a subprocess
 * directly.
 */
export interface AgentSessionRuntime {
  start(): Promise<void>;
  send(text: string): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
  readonly events: EventEmitter;
}

export interface RuntimeOptions {
  readonly command: string;
  readonly args: string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Called when the agent process prints a line (stdout or stderr merged). */
  readonly onLine?: (stream: 'stdout' | 'stderr', line: string) => void;
  readonly onExit?: (code: number | null) => void;
}

/**
 * Real subprocess-backed runtime. Spawns a persistent agent process, streams
 * its output, and supports cancellation. Model/provider failover is handled
 * BELOW this layer by the session manager (the agent simply talks to the
 * Nexus gateway URL, which performs routing/failover transparently).
 */
export class SubprocessSessionRuntime implements AgentSessionRuntime {
  readonly events = new EventEmitter();
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';

  constructor(private readonly opts: RuntimeOptions) {}

  async start(): Promise<void> {
    if (this.proc) return;
    this.proc = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout.on('data', (d) => this.emitLine('stdout', d.toString()));
    this.proc.stderr.on('data', (d) => this.emitLine('stderr', d.toString()));
    this.proc.on('exit', (code) => {
      this.opts.onExit?.(code);
      this.events.emit('exit', code);
    });
    this.proc.on('error', (err) => this.events.emit('error', err));
  }

  async send(text: string): Promise<void> {
    if (!this.proc) throw new Error('runtime not started');
    this.proc.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
  }

  async pause(): Promise<void> {
    // SIGTSTP requests a cooperative stop; if unsupported, the session layer
    // marks PAUSED without killing the process.
    this.proc?.kill('SIGTSTP');
  }

  async resume(): Promise<void> {
    this.proc?.kill('SIGCONT');
  }

  async cancel(): Promise<void> {
    this.proc?.kill('SIGTERM');
  }

  async terminate(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill('SIGKILL');
    this.proc = null;
  }

  private emitLine(stream: 'stdout' | 'stderr', chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.opts.onLine?.(stream, line);
      this.events.emit('line', stream, line);
    }
  }
}
