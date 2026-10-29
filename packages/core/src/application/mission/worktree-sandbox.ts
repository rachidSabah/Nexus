import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WorktreeLease {
  missionId: string;
  nodeId: string;
  branchName: string;
  worktreePath: string;
  baseCommit: string;
}

export interface MergeResult {
  merged: boolean;
  conflictedFiles: string[];
  commitHash?: string;
}

export class GitWorktreeArbiter {
  private readonly sandboxRoot: string;

  constructor(
    private readonly repoRoot: string,
    sandboxRoot?: string,
  ) {
    this.sandboxRoot = sandboxRoot ?? path.join(tmpdir(), 'nexus-worktrees');
  }

  public getSandboxRoot(): string {
    return this.sandboxRoot;
  }

  public async acquireWorktree(missionId: string, nodeId: string): Promise<WorktreeLease> {
    await fs.mkdir(this.sandboxRoot, { recursive: true });
    const safeNodeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeMissionId = missionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const branchName = `nexus/mission-${safeMissionId}/${safeNodeId}`;
    const worktreePath = path.resolve(this.sandboxRoot, `${safeMissionId}-${safeNodeId}`);

    const { stdout: headOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: this.repoRoot,
    });
    const baseCommit = headOut.trim();

    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: this.repoRoot,
      });
    } catch {
      // Ignored if it did not exist
    }

    await execFileAsync('git', ['worktree', 'add', '-B', branchName, worktreePath, baseCommit], {
      cwd: this.repoRoot,
    });

    return { missionId, nodeId, branchName, worktreePath, baseCommit };
  }

  public async commitAndMergeWorktree(lease: WorktreeLease, _targetBranch = 'main'): Promise<MergeResult> {
    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: lease.worktreePath,
    });

    if (statusOut.trim().length > 0) {
      await execFileAsync('git', ['add', '-A'], { cwd: lease.worktreePath });
      await execFileAsync(
        'git',
        ['commit', '-m', `feat(mission:${lease.missionId}): complete DAG node ${lease.nodeId}`],
        { cwd: lease.worktreePath },
      );
    }

    try {
      await execFileAsync('git', ['merge', '--no-ff', lease.branchName], {
        cwd: this.repoRoot,
      });
      const { stdout: mergedHash } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.repoRoot,
      });
      return { merged: true, conflictedFiles: [], commitHash: mergedHash.trim() };
    } catch {
      let conflictedFiles: string[] = [];
      try {
        const { stdout: diffOut } = await execFileAsync(
          'git',
          ['diff', '--name-only', '--diff-filter=U'],
          { cwd: this.repoRoot },
        );
        conflictedFiles = diffOut.split('\n').map((f) => f.trim()).filter(Boolean);
      } catch {
        // Fallback
      }
      await execFileAsync('git', ['merge', '--abort'], { cwd: this.repoRoot }).catch(() => {});
      return { merged: false, conflictedFiles };
    }
  }

  public async releaseWorktree(lease: WorktreeLease): Promise<void> {
    await execFileAsync('git', ['worktree', 'remove', '--force', lease.worktreePath], {
      cwd: this.repoRoot,
    }).catch(() => {});
    await execFileAsync('git', ['branch', '-D', lease.branchName], {
      cwd: this.repoRoot,
    }).catch(() => {});
  }
}
