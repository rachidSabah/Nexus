/**
 * Default connector portfolio (blueprint §3 list) + repository factory.
 *
 * Connector lineup: OpenRouter (documented catalog), Hugging Face Hub,
 * GitHub security advisories (redacted leak intelligence), local self-hosted
 * runtimes (loopback only).
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { SqliteDB } from '@anx/persistence';

import { GitHubAdvisoriesConnector } from './connectors/github.js';
import { HuggingFaceConnector } from './connectors/huggingface.js';
import { LocalServersConnector } from './connectors/local.js';
import { OpenRouterConnector } from './connectors/openrouter.js';
import { InMemoryIntelligenceRepository, type IntelligenceRepository } from './repository.js';
import { SqliteIntelligenceRepository } from './sqlite-repository.js';
import type { DiscoveryConnector } from './types.js';

export function createDefaultConnectors(): DiscoveryConnector[] {
  return [
    new OpenRouterConnector(),
    new HuggingFaceConnector(),
    new GitHubAdvisoriesConnector(),
    new LocalServersConnector(),
  ];
}

/**
 * Attempts node:sqlite DIRECTLY (not the @anx/persistence JSON emulator, whose
 * statement matcher only knows its own tables — silently dropping writes into
 * intelligence tables would be a data-loss fault).
 */
async function openDatabaseSync(path: string): Promise<SqliteDB> {
  const sqlite = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (p: string) => SqliteDB;
  };
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  return new sqlite.DatabaseSync(path) as SqliteDB;
}

/**
 * Chooses the best available backend: SQLite (node:sqlite, Node >= 22) when
 * present, in-memory otherwise. The degradation is observable via the
 * connectors/overview endpoints and the discovery health report.
 */
export async function createIntelligenceRepository(options: { path: string }): Promise<IntelligenceRepository> {
  try {
    const db = await openDatabaseSync(options.path);
    return new SqliteIntelligenceRepository(options.path, async () => db);
  } catch {
    return new InMemoryIntelligenceRepository();
  }
}

export function defaultIntelligenceDbPath(): string {
  const override = process.env['NEXUS_DB_PATH'];
  if (override) return override;
  return join(homedir(), '.agent-nexus', 'nexus.db');
}
