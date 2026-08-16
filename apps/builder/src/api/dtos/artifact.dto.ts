import { z } from 'zod';

export const StoreArtifactSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'binary',
    'tarball',
    'zip',
    'directory',
    'docker_image',
    'manifest',
    'log',
    'coverage',
    'bundle',
  ]).default('binary'),
  mimeType: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type StoreArtifactDto = z.infer<typeof StoreArtifactSchema>;
