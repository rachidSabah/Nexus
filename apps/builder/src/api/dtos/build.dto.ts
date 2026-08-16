import { z } from 'zod';
import { StepConfigSchema } from './project.dto.js';

export const TriggerBuildSchema = z.object({
  projectId: z.string().min(1),
  templateId: z.string().optional(),
  commitHash: z.string().optional(),
  branch: z.string().optional(),
  customSteps: z.array(StepConfigSchema).optional(),
  environmentOverrides: z.record(z.string()).optional(),
  workspaceDir: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export type TriggerBuildDto = z.infer<typeof TriggerBuildSchema>;

export const CancelBuildSchema = z.object({
  reason: z.string().max(200).optional(),
});

export type CancelBuildDto = z.infer<typeof CancelBuildSchema>;

export const ListBuildsQuerySchema = z.object({
  projectId: z.string().optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListBuildsQueryDto = z.infer<typeof ListBuildsQuerySchema>;
