import { z } from 'zod';

export const StepConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
  continueOnError: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  repositoryUrl: z.string().url().optional().or(z.literal('')),
  branch: z.string().default('main'),
  framework: z.enum(['node', 'typescript', 'react', 'nextjs', 'python', 'rust', 'go', 'custom']).default('typescript'),
  rootDirectory: z.string().optional(),
  defaultSteps: z.array(StepConfigSchema).optional(),
  environment: z.record(z.string()).optional(),
});

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = CreateProjectSchema.partial();
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
