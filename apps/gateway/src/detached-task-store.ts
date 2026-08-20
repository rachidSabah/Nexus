import { randomUUID } from 'node:crypto';

/**
 * WS4-C: Detached background task store for long-running vibe-coding runs.
 *
 * A coding agent can POST a (non-streaming) completion to `/v1/tasks` with a
 * detached flag; the gateway runs it to completion in the background and
 * returns a job id immediately. The agent polls `GET /v1/tasks/:id` for the
 * result. This makes a long task survive the *agent's* own network drop or
 * crash (à la Claude Code's `/fork`): the gateway keeps working and the agent
 * resumes by polling the job id.
 *
 * In-memory only — gateway restart loses in-flight jobs (deliberately out of
 * scope; that's the heavier "request journal" variant). Completing a job
 * stores the final content + token usage so the poll returns once and then
 * the job is garbage-collectable.
 */
export type DetachedTaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DetachedTask {
  id: string;
  model: string;
  status: DetachedTaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  content?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}

export class DetachedTaskStore {
  private readonly jobs = new Map<string, DetachedTask>();

  create(model: string): DetachedTask {
    const job: DetachedTask = {
      id: `task_${randomUUID().slice(0, 12)}`,
      model,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): DetachedTask | undefined {
    return this.jobs.get(id);
  }

  list(): readonly DetachedTask[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  start(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'running';
      job.startedAt = Date.now();
    }
  }

  complete(id: string, content: string, usage?: DetachedTask['usage']): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'completed';
      job.content = content;
      job.usage = usage;
      job.finishedAt = Date.now();
    }
  }

  fail(id: string, error: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.finishedAt = Date.now();
    }
  }

  /** Drop finished jobs older than `maxAgeMs` to bound memory. */
  gc(maxAgeMs = 6 * 60 * 60 * 1000): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt && now - job.finishedAt > maxAgeMs) this.jobs.delete(id);
    }
  }
}
