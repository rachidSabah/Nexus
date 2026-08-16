import { EnvConfig, EnvSchema } from './env.schema.js';

export class AppConfig {
  private static instance: AppConfig;
  public readonly values: EnvConfig;

  private constructor(overrides?: Partial<EnvConfig>) {
    const rawEnv = {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      HOST: process.env.HOST,
      LOG_LEVEL: process.env.LOG_LEVEL,
      WORKSPACE_ROOT: process.env.WORKSPACE_ROOT,
      ARTIFACT_STORAGE_DIR: process.env.ARTIFACT_STORAGE_DIR,
      MAX_CONCURRENT_BUILDS: process.env.MAX_CONCURRENT_BUILDS,
      DEFAULT_BUILD_TIMEOUT_MS: process.env.DEFAULT_BUILD_TIMEOUT_MS,
      ENABLE_FILE_PERSISTENCE: process.env.ENABLE_FILE_PERSISTENCE,
      PERSISTENCE_FILE_PATH: process.env.PERSISTENCE_FILE_PATH,
      CORS_ORIGIN: process.env.CORS_ORIGIN,
      ...overrides,
    };

    const parsed = EnvSchema.safeParse(rawEnv);
    if (!parsed.success) {
      const formattedErrors = parsed.error.format();
      throw new Error(`Invalid Builder Configuration: ${JSON.stringify(formattedErrors, null, 2)}`);
    }

    this.values = parsed.data;
  }

  public static load(overrides?: Partial<EnvConfig>): AppConfig {
    AppConfig.instance = new AppConfig(overrides);
    return AppConfig.instance;
  }

  public static get(): AppConfig {
    if (!AppConfig.instance) {
      AppConfig.instance = new AppConfig();
    }
    return AppConfig.instance;
  }
}
