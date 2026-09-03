// packages/dsh-ssf/lib/cli-runner.js — spec-superflow CLI 执行适配层（w1-runner）
//
// 统一执行通道：经 ctx.subprocess 异步 spawn `node <repoRoot>/scripts/spec-superflow.mjs`
// 目标为去掉对 PATH 上全局 `ssf` 符号链接的依赖（D3），并隔离 process.exit / console 直写 / spawnSync 三类风险（D1）。
//
// R1 已结案：graceMs 是 terminate 宽限（SIGTERM → graceMs → SIGKILL 升级与管道排空宽限），
// 并非执行超时。证据：packages/subprocess 的 SpawnSpec.graceMs 注释 "the caller owns deadlines"；
// spawn.ts:452 仅在 terminate 后启动 SIGKILL 计时器；SpawnSpec 无 timeout 字段。
// 结论：全部写工具沿用 30000 默认值，不因 finish 的 10 分钟验证而放宽（finish 在子进程内正常运行至结束）。
// 本 runner 的 graceMs 默认 30000，透传调用方覆盖值，仅作为子进程终止宽限。
import { join } from 'node:path';
import { resolveChangePath } from './tools.js';

// 默认 terminate 宽限：30 秒（与既有 ssf_run 一致，R1 结论不放宽）
const DEFAULT_GRACE_MS = 30000;
const MAX_BYTES = 1024 * 1024; // 1MB 捕获上限（高于 ssf_run 的 64KB，满足新工具需求）

/**
 * 创建 CLI runner。
 *
 * repoRoot 由调用方以 `join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')` 定位（相对 lib/），
 * 指向仓库根；runner 内部用 `[process.execPath, join(repoRoot, 'scripts', 'spec-superflow.mjs'), ...args]`
 * 作为 spawn argv（去掉 PATH 依赖）。
 *
 * cwd 由 `registerTools` 的 `resolveRoot()` 提供（会话工作区根）；若未提供则回退到 process.cwd()。
 * 这样 spawn 的 CLI 在正确的工作区解析 changes/<name> 路径。
 *
 * 复用 `tools.js` 已有的 `resolveChangePath` 语义校验 changeDir（不复制实现）；若 changeDir 非空则校验后才 spawn。
 *
 * @param {{ subprocess: { spawn: (spec: object) => any }, repoRoot: string, onBind?: (sessionId: string, changeDir: string) => any, refresh?: () => Promise<any>, resolveRoot?: () => string }} deps
 * @returns {(opts: { args: string[], changeDir?: string, json?: boolean, graceMs?: number, sessionId?: string, exec?: { agent?: { session?: { id?: string } } } }) => Promise<{ ok: boolean, exitCode: number, result?: object, stdout: string, stderr: string }>}
 */
export function createCliRunner({ subprocess, repoRoot, onBind, refresh, resolveRoot } = {}) {
  if (!subprocess || typeof subprocess.spawn !== 'function') {
    throw new Error('createCliRunner: subprocess.spawn is required');
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new Error('createCliRunner: repoRoot is required');
  }
  const cliScript = join(repoRoot, 'scripts', 'spec-superflow.mjs');

  /**
   * 执行 ssf CLI。
   * @param {object} opts
   * @param {string[]} opts.args - 子命令 argv（不含 node/script 前缀），每个元素原样作为独立 argv 元素透传
   * @param {string} [opts.changeDir] - 变更目录名（相对 changes/）；非空时先经 resolveChangePath 校验
   * @param {boolean} [opts.json] - 是否以 --json 执行；为 true 时在 args 末尾幂等追加 --json，并在 exitCode 0 时解析 stdout
   * @param {number} [opts.graceMs] - terminate 宽限（SIGTERM→SIGKILL），默认 30000；R1 已结案不因 finish 放宽
   * @param {string} [opts.sessionId] - 调用会话 id（用于 onBind）；也可通过 exec 传入
   * @param {object} [opts.exec] - dsh-tools execute 上下文，含 agent.session.id 时优先提取
   * @returns {Promise<{ ok: boolean, exitCode: number, result?: object, stdout: string, stderr: string }>}
   */
  return async function runSsf({ args = [], changeDir, json = false, graceMs, sessionId, exec } = {}) {
    if (!Array.isArray(args)) {
      throw new Error('runSsf: args must be an array of strings');
    }
    for (const arg of args) {
      if (typeof arg !== 'string') throw new Error('runSsf: every argument must be a string');
    }

    // cwd 来源：会话工作区根（registerTools 的 resolveRoot），保证 changeDir 解析与 CLI 执行在同一根下
    let workspaceRoot;
    try {
      workspaceRoot = typeof resolveRoot === 'function' ? resolveRoot() : process.cwd();
    } catch {
      workspaceRoot = process.cwd();
    }

    // changeDir 非空则先校验（复用 tools.js 语义，拒绝空/绝对路径/.. 遍历）
    if (changeDir !== undefined && changeDir !== null && changeDir !== '') {
      resolveChangePath(workspaceRoot, changeDir);
    }

    // json:true 时在末尾幂等追加 --json
    const effectiveArgs = [...args];
    if (json) {
      if (!effectiveArgs.includes('--json')) effectiveArgs.push('--json');
    }

    const argv = [process.execPath, cliScript, ...effectiveArgs];

    const spec = {
      argv,
      cwd: workspaceRoot,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_BYTES },
        stderr: { maxBytes: MAX_BYTES },
      },
      graceMs: graceMs ?? DEFAULT_GRACE_MS,
    };

    const handle = subprocess.spawn(spec);
    const outcome = await handle.done;
    const exitCode = outcome?.exitCode ?? outcome?.status ?? -1;

    // 兼容不同 handle.collected 形态（fake/real）
    const stdout = handle.collected?.stdout?.readFrom?.(0)?.text ?? handle.collected?.stdout?.text ?? '';
    const stderr = handle.collected?.stderr?.readFrom?.(0)?.text ?? handle.collected?.stderr?.text ?? '';

    let ok = exitCode === 0;
    let result;
    let finalStderr = stderr;

    if (json && exitCode === 0) {
      try {
        result = JSON.parse(stdout);
      } catch (err) {
        ok = false;
        const msg = err instanceof Error ? err.message : String(err);
        finalStderr = stderr ? `${stderr}\nJSON parse error: ${msg}` : `JSON parse error: ${msg}`;
      }
    }

    if (ok && changeDir) {
      // 提取有效 sessionId：优先显式 sessionId，其次 exec.agent.session.id
      let effectiveSessionId = sessionId;
      if (effectiveSessionId === undefined && exec?.agent?.session?.id !== undefined) {
        effectiveSessionId = exec.agent.session.id;
      }
      // 成功后依次 onBind 与 refresh，均为 best-effort
      try {
        if (typeof onBind === 'function') {
          if (effectiveSessionId !== undefined) {
            await onBind(effectiveSessionId, changeDir);
          } else {
            // 无 session 时宿主 bindSession 会 no-op，仍调用一次以保持语义
            await onBind(undefined, changeDir);
          }
        }
      } catch {
        // best-effort — 绑定失败不影响结果
      }
      try {
        if (typeof refresh === 'function') await refresh();
      } catch {
        // best-effort
      }
    }

    const out = { ok, exitCode, stdout, stderr: finalStderr };
    if (result !== undefined) out.result = result;
    return out;
  };
}
