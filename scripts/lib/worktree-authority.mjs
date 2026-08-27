// scripts/lib/worktree-authority.mjs — worktree 权威指针与副本分叉检测
import { existsSync, realpathSync } from 'node:fs';
import { basename, join, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readState, writeState } from './state-loader.mjs';
import { computeArtifactsHash } from './hash.mjs';

/**
 * 解析 changeDir 所在 git 仓库根（realpath 化）。
 * 实现：execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: changeDir })，
 * 与 scripts/lib/config-loader.mjs:74 相同方式。
 */
export function repoRootFor(changeDir) {
  const raw = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: changeDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  return realpathSync(raw);
}

/**
 * 记录主隔离 worktree 指针。仅当 name 等于变更目录名（主隔离约定）时写入；
 * prototype-<id> 等其它名称不写。状态文件不存在时跳过（isolate 可用在无状态目录）。
 */
export function recordWorktree(changeDir, repoRoot, worktreePath) {
  const statePath = join(changeDir, '.spec-superflow.yaml');
  if (!existsSync(statePath)) return;
  if (basename(worktreePath) !== basename(resolve(changeDir))) return;
  const state = readState(changeDir);
  state.worktree = worktreePath.slice(repoRoot.length + 1); // 仓库相对路径
  writeState(changeDir, state);
}

/**
 * 比较主检出副本与 worktree 副本。
 * 返回 { diverged, worktreeNewer, freshnessKnown, worktreePath }；
 * worktree 为 null 或 worktree 副本不存在时 diverged=false。
 * 判定：两副本均有状态文件 → 比较 last_transition（字典序=时间序），freshnessKnown=true；
 * 任一副本缺状态文件 → 退化为 computeArtifactsHash 比较，不等即 diverged，freshnessKnown=false（新旧不可判定）。
 */
export function divergence(changeDir) {
  const state = readState(changeDir);
  if (!state.worktree) return { diverged: false, worktreeNewer: false, freshnessKnown: true, worktreePath: null };
  const repoRoot = repoRootFor(changeDir);
  const changeRelativePath = relative(repoRoot, realpathSync(resolve(changeDir))); // 同 ensure-branch.mjs:92
  const worktreeChangeDir = join(repoRoot, state.worktree, changeRelativePath);
  const result = { diverged: false, worktreeNewer: false, freshnessKnown: true, worktreePath: worktreeChangeDir };
  if (!existsSync(worktreeChangeDir)) return result;
  const wtStatePath = join(worktreeChangeDir, '.spec-superflow.yaml');
  if (existsSync(wtStatePath)) {
    const wt = readState(worktreeChangeDir);
    const srcTs = state.last_transition ?? '';
    const wtTs = wt.last_transition ?? '';
    if (wtTs !== srcTs) {
      result.diverged = true;
      result.worktreeNewer = wtTs > srcTs; // ISO 时间戳字典序即时间序
    } else if (computeArtifactsHash(changeDir) !== computeArtifactsHash(worktreeChangeDir)) {
      // equal ts but artifact content differs → diverged (freshnessKnown stays true, worktreeNewer false)
      result.diverged = true;
    }
    return result;
  }
  // 任一副本缺状态文件 → 退化为内容 hash 比较，不等即分叉；新旧不可判定
  result.freshnessKnown = false;
  if (computeArtifactsHash(changeDir) !== computeArtifactsHash(worktreeChangeDir)) {
    result.diverged = true;
  }
  return result;
}

/**
 * warn-only：diverged 时向 stderr 打印权威路径与分叉说明；返回值与退出码不受影响。
 */
export function warnIfDiverged(changeDir) {
  const d = divergence(changeDir);
  if (d.diverged) {
    console.error(`warning: change artifacts diverged between this copy and the worktree copy at ${d.worktreePath}. The worktree copy is the authoritative implementation location; resolve the divergence before relying on this copy.`);
  }
}
