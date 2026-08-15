/**
 * ─────────────────────────────────────────────────────────────────────────────
 * MissionStore — Phase 29 In-Memory Store with Checkpoint & Recovery Support.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type {
  Mission,
  MissionCheckpoint,
  MissionEvent,
  MissionStatus,
} from '../../domain/mission.js';

export class MissionStore {
  private missions = new Map<string, Mission>();
  private checkpoints = new Map<string, MissionCheckpoint[]>();
  private events = new Map<string, MissionEvent[]>();

  save(mission: Mission): void {
    this.missions.set(mission.id, { ...mission, updatedAt: Date.now() });
  }

  get(id: string): Mission | undefined {
    return this.missions.get(id);
  }

  list(filter?: { status?: MissionStatus; limit?: number }): Mission[] {
    let all = Array.from(this.missions.values()).sort((a, b) => b.createdAt - a.createdAt);
    if (filter?.status) {
      all = all.filter((m) => m.status === filter.status);
    }
    if (filter?.limit && filter.limit > 0) {
      all = all.slice(0, filter.limit);
    }
    return all;
  }

  delete(id: string): boolean {
    this.checkpoints.delete(id);
    this.events.delete(id);
    return this.missions.delete(id);
  }

  addCheckpoint(checkpoint: MissionCheckpoint): void {
    const list = this.checkpoints.get(checkpoint.missionId) ?? [];
    list.push(checkpoint);
    this.checkpoints.set(checkpoint.missionId, list);

    const m = this.missions.get(checkpoint.missionId);
    if (m) {
      m.checkpointsCount = list.length;
      this.missions.set(checkpoint.missionId, m);
    }
  }

  getCheckpoints(missionId: string): MissionCheckpoint[] {
    return this.checkpoints.get(missionId) ?? [];
  }

  getLatestCheckpoint(missionId: string): MissionCheckpoint | undefined {
    const list = this.checkpoints.get(missionId) ?? [];
    return list[list.length - 1];
  }

  addEvent(event: MissionEvent): void {
    const list = this.events.get(event.missionId) ?? [];
    list.push(event);
    this.events.set(event.missionId, list);
  }

  getEvents(missionId: string): MissionEvent[] {
    return this.events.get(missionId) ?? [];
  }

  clear(): void {
    this.missions.clear( );
    this.checkpoints.clear();
    this.events.clear();
  }
}
