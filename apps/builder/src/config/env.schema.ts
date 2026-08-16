import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1024).max(65535).default(3050),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  WORKSPACE_ROOT: z.string().default('./.builder-workspaces'),
  ARTIFACT_STORAGE_DIR: z.string().default('./.builder-artifacts'),
  MAX_CONCURRENT_BUILDS: z.coerce.number().min(1).max(32).default(4),
  DEFAULT_BUILD_TIMEOUT_MS: z.coerce.number().min(1000).max(3600000).default(300000), // 5 mins
  ENABLE_FILE_PERSISTENCE: z.coerce.boolean().default(false),
  PERSISTENCE_FILE_PATH: z.string().default('./.builder-data/projects.json'),
  CORS_ORIGIN: z.string().default('*'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
