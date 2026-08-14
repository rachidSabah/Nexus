import { type AgentTask } from '../domain/orchestration.js';

export interface TaskStorePort {
  save(task: AgentTask): Promise<void>;
  get(taskId: string): Promise<AgentTask | undefined>;
  list(filter?: { status?: string; category?: string }): Promise<readonly AgentTask[]>;
}

export class InMemoryTaskStore implements TaskStorePort {
  private readonly tasks = new Map<string, AgentTask>();

  async save(task: AgentTask): Promise<void> {
    this.tasks.set(task.taskId, { ...task });
  }

  async get(taskId: string): Promise<AgentTask | undefined> {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  async list(filter?: { status?: string; category?: string }): Promise<readonly AgentTask[]> {
    let result = Array.from(this.tasks.values());
    if (filter?.status) {
      result = result.filter(t => t.status === filter.status);
    }
    if (filter?.category) {
      result = result.filter(t => t.category === filter.category);
    }
    return result;
  }
}
