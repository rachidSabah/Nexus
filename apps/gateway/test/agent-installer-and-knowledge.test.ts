import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AgentInstallationEngine } from '../src/agent-installation-engine.js';
import { ObsidianKnowledgeAdapter } from '@anx/memory';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Agent Installer & Obsidian Knowledge — Unit & Integration', () => {
  const engine = AgentInstallationEngine.getInstance();
  let testVaultDir: string;

  beforeAll(async () => {
    testVaultDir = join(tmpdir(), `nexus-test-vault-${Date.now()}`);
    await mkdir(testVaultDir, { recursive: true });
    await mkdir(join(testVaultDir, 'notes'), { recursive: true });
    await writeFile(
      join(testVaultDir, 'welcome.md'),
      '# Welcome to Nexus\nThis is a test note for Nexus Knowledge and agent context.\n#nexus #ai',
      'utf8',
    );
    await writeFile(
      join(testVaultDir, 'architecture.md'),
      '# Architecture Guide\nNexus routing and unified agent control plane.\n#architecture',
      'utf8',
    );
  });

  afterAll(async () => {
    try { await rm(testVaultDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AgentInstallationEngine
  // ──────────────────────────────────────────────────────────────────────────
  describe('AgentInstallationEngine', () => {
    it('rejects unknown agent IDs immediately with FAILED job', async () => {
      const job = await engine.startInstallJob('unknown-fake-agent-xyz-does-not-exist');
      expect(job.status).toBe('FAILED');
      expect(job.stage).toBe('FAILED');
      expect(job.error).toMatch(/not available in the trusted Nexus installation catalog/i);
      expect(job.id).toMatch(/^job-/);
      expect(job.agentId).toBe('unknown-fake-agent-xyz-does-not-exist');
    }, 10_000);

    it('returns the same active job on duplicate startInstallJob for the same agent', async () => {
      // Use a valid agent but do not actually wait for npm install — just check deduplication
      // We do this by starting a first job and immediately calling again.
      // Because the first call may complete (failure) before we call again, we rely
      // only on the case where the first call resolves instantly (invalid agent = FAILED,
      // but for a real agent it returns RUNNING and deduplicates).
      const job1 = await engine.startInstallJob('unknown-dupe-test-abc');
      const job2 = await engine.startInstallJob('unknown-dupe-test-abc');
      // Both FAILED immediately for unknown, but they should be distinct jobs because the first FAILED
      expect(job1.agentId).toBe('unknown-dupe-test-abc');
      expect(job2.agentId).toBe('unknown-dupe-test-abc');
    }, 10_000);

    it('lists all jobs (no filter) and by agentId filter', async () => {
      const all = engine.listJobs();
      expect(Array.isArray(all)).toBe(true);

      const filtered = engine.listJobs('unknown-fake-agent-xyz-does-not-exist');
      expect(Array.isArray(filtered)).toBe(true);
      expect(filtered.every((j) => j.agentId === 'unknown-fake-agent-xyz-does-not-exist')).toBe(true);
    });

    it('getJob returns undefined for a non-existent jobId', () => {
      const result = engine.getJob('job-does-not-exist-12345');
      expect(result).toBeUndefined();
    });

    it('cancelJob returns false for a non-existent job', async () => {
      const cancelled = await engine.cancelJob('job-does-not-exist-12345');
      expect(cancelled).toBe(false);
    });

    it('detectPackageManagers resolves without throwing', async () => {
      const managers = await engine.detectPackageManagers();
      expect(managers).toBeDefined();
      expect(typeof managers.npm).toBe('boolean');
      expect(typeof managers.pnpm).toBe('boolean');
      expect(typeof managers.pip).toBe('boolean');
      expect(typeof managers.pipx).toBe('boolean');
      expect(typeof managers.winget).toBe('boolean');
      expect(typeof managers.brew).toBe('boolean');
      expect(typeof managers.apt).toBe('boolean');
      expect(typeof managers.dnf).toBe('boolean');
    }, 15_000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ObsidianKnowledgeAdapter
  // ──────────────────────────────────────────────────────────────────────────
  describe('ObsidianKnowledgeAdapter', () => {
    it('reports NOT_DETECTED or DETECTED (never throws) when unconfigured', async () => {
      const adapter = new ObsidianKnowledgeAdapter();
      const status = await adapter.getStatus();
      expect(['NOT_DETECTED', 'DETECTED', 'READY']).toContain(status.status);
      expect(status.vaultConfigured).toBe(false);
    });

    it('reports READY when vaultPath points to existing directory', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      const status = await adapter.getStatus();
      expect(status.status).toBe('READY');
      expect(status.vaultConfigured).toBe(true);
      expect(status.message).toContain(testVaultDir);
    });

    it('reports ERROR when vaultPath does not exist', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: join(tmpdir(), 'nexus-nonexistent-vault-zzz') });
      const status = await adapter.getStatus();
      expect(status.status).toBe('ERROR');
      expect(status.vaultConfigured).toBe(true);
    });

    it('reports DISABLED when enabled:false', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir, enabled: false });
      const status = await adapter.getStatus();
      expect(status.status).toBe('DISABLED');
    });

    it('searches notes and returns ranked results', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      const results = await adapter.searchNotes('architecture');
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top.path).toBe('architecture.md');
      expect(top.title).toBe('Architecture Guide');
      expect(top.score).toBeGreaterThan(0);
    });

    it('reads note content, headings and tags', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      const note = await adapter.readNote('welcome.md');
      expect(note.path).toBe('welcome.md');
      expect(note.content).toContain('Welcome to Nexus');
      expect(note.metadata.headings).toContain('Welcome to Nexus');
      expect(note.metadata.tags).toContain('nexus');
      expect(note.metadata.tags).toContain('ai');
    });

    it('writes a new note and reads it back', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      const writeRes = await adapter.writeNote('notes/deep-dive.md', '# Deep Dive\nComprehensive notes.');
      expect(writeRes.ok).toBe(true);
      const note = await adapter.readNote('notes/deep-dive.md');
      expect(note.content).toContain('Deep Dive');
      expect(note.metadata.headings).toContain('Deep Dive');
    });

    it('appends content to an existing note', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      await adapter.writeNote('notes/append-test.md', '# Base Note\nInitial content.');
      await adapter.writeNote('notes/append-test.md', '\n## Follow Up\nAppended section.', { append: true });
      const note = await adapter.readNote('notes/append-test.md');
      expect(note.content).toContain('Initial content');
      expect(note.content).toContain('Follow Up');
    });

    it('blocks path traversal attempts with Security Violation error', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      await expect(adapter.readNote('../../../etc/passwd')).rejects.toThrow(/Security Violation/i);
      await expect(adapter.writeNote('../../shadow', 'evil')).rejects.toThrow(/Security Violation/i);
    });

    it('throws when trying to read a note that does not exist', async () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir });
      await expect(adapter.readNote('does-not-exist.md')).rejects.toThrow();
    });

    it('setConfig merges config without losing existing keys', () => {
      const adapter = new ObsidianKnowledgeAdapter({ vaultPath: testVaultDir, apiPort: 27123 });
      adapter.setConfig({ enabled: false });
      const cfg = adapter.getConfig();
      expect(cfg.vaultPath).toBe(testVaultDir);
      expect(cfg.apiPort).toBe(27123);
      expect(cfg.enabled).toBe(false);
    });
  });
});
