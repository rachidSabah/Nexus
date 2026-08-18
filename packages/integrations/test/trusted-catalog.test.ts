import { describe, expect, it } from 'vitest';

import { getAgentCatalogEntry, TRUSTED_AGENT_CATALOG } from '../src/catalog.js';
import { INTEGRATION_IDS } from '../src/registry.js';

describe('trusted agent catalog', () => {
  it('has no duplicate ids', () => {
    const ids = TRUSTED_AGENT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('recognizes every integration adapter id (single source of truth)', () => {
    // Every agent the dashboard/installer/CLI can act on must exist in the
    // trusted catalog. Otherwise the install endpoint returns
    // "Agent '<id>' is not recognized in the trusted Agent Catalog" while the
    // dashboard still shows it. That mismatch is forbidden.
    const missing = INTEGRATION_IDS.filter((id) => !getAgentCatalogEntry(id));
    expect(missing, `integration ids missing from trusted catalog: ${missing.join(', ')}`).toEqual([]);
  });

  it('every catalog entry carries a binary name and a safe install recipe', () => {
    for (const entry of TRUSTED_AGENT_CATALOG) {
      expect(entry.binaryNames.length, `${entry.id} must declare binaryNames`).toBeGreaterThan(0);
      expect(['npm', 'pip', 'binary', 'manual']).toContain(entry.installRecipe.type);
      if (entry.installRecipe.type === 'npm' || entry.installRecipe.type === 'pip') {
        expect(entry.installRecipe.packageName, `${entry.id} ${entry.installRecipe.type} recipe needs packageName`).toBeTruthy();
      }
    }
  });
});
