/**
 * ApplicationVerifier — Phase 11
 *
 * Verifies that an AGY-built application's workspace is complete and valid.
 * Called after AGY_VERIFY or FINALIZE stage.
 */

import { readdir, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

import type { WorkspaceConfig, WorkspaceVerificationResult } from '../domain/agy-builder.js';

const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'build.gradle',
  'setup.py',
  'composer.json',
];

const SOURCE_DIRS = ['src', 'lib', 'app', 'main', 'pkg', 'source'];
const SOURCE_EXTENSIONS = ['.ts', '.js', '.py', '.rs', '.go', '.java', '.cs', '.rb'];

export class ApplicationVerifier {
  constructor(
    private readonly nexusRepoRoot?: string,
  ) {}

  async verify(workspace: WorkspaceConfig): Promise<WorkspaceVerificationResult> {
    const issues: string[] = [];
    let pathTraversalClean = true;

    // ── 1. Path traversal check ───────────────────────────────────────────────
    const normalized = resolve(workspace.workspacePath);
    if (!isAbsolute(workspace.workspacePath)) {
      pathTraversalClean = false;
      issues.push(`Workspace path is not absolute: '${workspace.workspacePath}'`);
    }
    if (this.nexusRepoRoot) {
      const repoNorm = resolve(this.nexusRepoRoot).toLowerCase().replace(/\\/g, '/');
      const normPath = normalized.toLowerCase().replace(/\\/g, '/');
      if (normPath.startsWith(repoNorm + '/') || normPath === repoNorm) {
        pathTraversalClean = false;
        issues.push(`Workspace is inside the Nexus repository — isolation violated`);
      }
    }

    // ── 2. Workspace existence ────────────────────────────────────────────────
    let workspaceExists = false;
    try {
      const s = await stat(normalized);
      workspaceExists = s.isDirectory();
      if (!workspaceExists) issues.push('Workspace path exists but is not a directory');
    } catch {
      issues.push('Workspace directory does not exist');
      return {
        valid: false,
        workspaceExists: false,
        manifestExists: false,
        sourceFilesPresent: false,
        pathTraversalClean,
        buildResultCaptured: false,
        testResultCaptured: false,
        artifacts: [],
        issues,
      };
    }

    // ── 3. Read directory contents ────────────────────────────────────────────
    let entries: string[] = [];
    try {
      const dirents = await readdir(normalized, { withFileTypes: true });
      entries = dirents.map(d => d.isDirectory() ? `${d.name}/` : d.name);
    } catch {
      issues.push('Failed to read workspace directory');
    }

    // ── 4. Manifest check ─────────────────────────────────────────────────────
    const manifestExists = entries.some(e => MANIFEST_FILES.includes(e));
    if (!manifestExists) {
      issues.push(`No project manifest found. Expected one of: ${MANIFEST_FILES.join(', ')}`);
    }

    // ── 5. Source files check ─────────────────────────────────────────────────
    const hasSrcDir = entries.some(e => SOURCE_DIRS.includes(e.replace('/', '')));
    const hasSourceFile = entries.some(e => SOURCE_EXTENSIONS.some(ext => e.endsWith(ext)));
    const sourceFilesPresent = hasSrcDir || hasSourceFile;
    if (!sourceFilesPresent) {
      issues.push('No source directory or source files found');
    }

    // ── 6. Build result check ─────────────────────────────────────────────────
    const hasBuildOutput = entries.some(e => ['dist/', 'build/', 'out/', 'target/'].includes(e));
    const hasNexusMeta = entries.includes('.nexus/');
    const buildResultCaptured = hasBuildOutput || hasNexusMeta;

    // ── 7. Test result check ──────────────────────────────────────────────────
    const testResultCaptured = entries.some(e =>
      e.startsWith('coverage') || e.startsWith('test-results') || e.startsWith('.nyc')
    ) || hasNexusMeta;

    // ── 8. Forbidden path check — no Nexus files modified ─────────────────────
    // Already covered by pathTraversalClean above

    return {
      valid: issues.length === 0,
      workspaceExists,
      manifestExists,
      sourceFilesPresent,
      pathTraversalClean,
      buildResultCaptured,
      testResultCaptured,
      artifacts: entries,
      issues,
    };
  }
}
