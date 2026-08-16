import { BuildStatus, StepStatus } from '../models/types.js';
import { Artifact } from '../models/artifact.js';

export interface BaseEvent {
  eventId: string;
  timestamp: Date;
  eventType: string;
}

export interface BuildCreatedEvent extends BaseEvent {
  eventType: 'build.created';
  buildId: string;
  projectId: string;
}

export interface BuildStartedEvent extends BaseEvent {
  eventType: 'build.started';
  buildId: string;
  projectId: string;
  workspacePath: string;
}

export interface StepStartedEvent extends BaseEvent {
  eventType: 'build.step.started';
  buildId: string;
  stepId: string;
  stepName: string;
  command: string;
}

export interface StepOutputEvent extends BaseEvent {
  eventType: 'build.step.output';
  buildId: string;
  stepId: string;
  chunk: string;
  isStderr: boolean;
}

export interface StepCompletedEvent extends BaseEvent {
  eventType: 'build.step.completed';
  buildId: string;
  stepId: string;
  stepName: string;
  status: StepStatus;
  exitCode?: number;
  durationMs?: number;
}

export interface ArtifactProducedEvent extends BaseEvent {
  eventType: 'build.artifact.produced';
  buildId: string;
  projectId: string;
  artifact: Artifact;
}

export interface BuildCompletedEvent extends BaseEvent {
  eventType: 'build.completed';
  buildId: string;
  projectId: string;
  status: BuildStatus;
  durationMs?: number;
  error?: string;
}

export type DomainEvent =
  | BuildCreatedEvent
  | BuildStartedEvent
  | StepStartedEvent
  | StepOutputEvent
  | StepCompletedEvent
  | ArtifactProducedEvent
  | BuildCompletedEvent;
