// scripts/lib/cmd-state.mjs — ssf state subcommand handler
import { parseArgs } from 'node:util';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState, writeState, updateField, rebuildState } from './state-loader.mjs';
import { computeArtifactsHash, computeContractHash } from './hash.mjs';
import { divergence, warnIfDiverged, repoRootFor } from './worktree-authority.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VALID_STATES = [
  'exploring', 'specifying', 'bridging', 'approved-for-build',
  'executing', 'debugging', 'closing', 'abandoned',
];

const SETTABLE_FIELDS = [
  'workflow', 'test_result', 'batches_completed', 'spec_merged',
  'dp_0_decisions', 'dp_0_confirmed', 'dp_0_timestamp', 'dp_0_result',
  'dp_1_result', 'dp_1_timestamp', 'dp_1_decisions', 'dp_1_confirmed',
  'dp_2_result', 'dp_2_timestamp', 'dp_2_decisions', 'dp_2_confirmed',
  'dp_3_result', 'dp_3_timestamp', 'dp_3_decisions', 'dp_3_confirmed',
  'dp_6_result', 'dp_6_timestamp', 'dp_6_decisions', 'dp_6_confirmed',
  'dp_7_result', 'dp_7_timestamp', 'dp_7_decisions', 'dp_7_confirmed',
];

export async function run(args) {
  const { positionals, values } = parseArgs({
    args,
    options: {
      json: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const sub = positionals[0];  // init | check | transition | get | rebuild | set
  const changeDir = positionals[1];
  const arg = positionals[2];  // <to-state> for transition, <field> for get

  if (!changeDir) {
    console.error('Usage: ssf state <subcommand> <change-dir> [arg]');
    console.error('Subcommands: init, check, transition, get, rebuild, set');
    process.exit(2);
  }

  // Unknown subcommand: report a usage error (exit 2) BEFORE the BUG-B
  // state-file existence check, so a bad subcommand is not masked by the
  // "No state file" error (which would return exit 1 instead of exit 2).
  const KNOWN_SUBS = ['init', 'check', 'transition', 'get', 'rebuild', 'set'];
  if (!KNOWN_SUBS.includes(sub)) {
    console.error(`Unknown subcommand: ${sub}. Valid: ${KNOWN_SUBS.join(', ')}`);
    process.exit(2);
  }

  // BUG-B: every subcommand except `init` requires an existing state file.
  // Without this check, readState silently returns defaults and `set` would
  // create a phantom .spec-superflow.yaml in the wrong directory (state drift).
  if (sub !== 'init') {
    const STATE_FILE = '.spec-superflow.yaml';
    if (!existsSync(join(changeDir, STATE_FILE))) {
      console.error(`No state file at ${join(changeDir, STATE_FILE)}. Run 'ssf state init <change-dir>' first.`);
      process.exit(1);
    }
  }

  switch (sub) {
    case 'init': {
      // A bare change name (no path separator, not dot-prefixed) targets
      // changes/<name>: `ssf state init my-change` must not create ./my-change
      // at the cwd root.
      const initDir = /[/\\]/.test(changeDir) || changeDir.startsWith('.')
        ? changeDir
        : join('changes', changeDir);
      if (!existsSync(initDir)) {
        mkdirSync(initDir, { recursive: true });
      }
      const hash = computeArtifactsHash(initDir);
      const ch = computeContractHash(initDir);
      const state = readState(initDir);
      state.artifacts_hash = hash;
      state.contract_hash = ch;
      state.last_transition = new Date().toISOString();
      writeState(initDir, state);
      if (values.json) {
        console.log(JSON.stringify({ ok: true, artifacts_hash: hash, contract_hash: ch }));
      } else {
        console.log(`State initialized. artifacts_hash: ${hash}`);
      }
      break;
    }
    case 'check': {
      const state = readState(changeDir);
      const currentHash = computeArtifactsHash(changeDir);
      const consistent = state.artifacts_hash === currentHash;
      if (values.json) {
        console.log(JSON.stringify({
          consistent,
          stored_hash: state.artifacts_hash,
          current_hash: currentHash,
          state: state.state,
        }));
      } else {
        if (consistent) {
          console.log('State consistent with artifacts.');
        } else {
          console.log('State INCONSISTENT — artifacts have changed since last transition.');
        }
        console.log(`  State: ${state.state}, stored hash: ${state.artifacts_hash}`);
        console.log(`  Current hash: ${currentHash}`);
      }
      process.exit(consistent ? 0 : 1);
      break;
    }
    case 'transition': {
      const toState = arg;
      if (!toState) {
        console.error('Usage: ssf state transition <change-dir> <to-state>');
        process.exit(2);
      }

      // Validate state name
      if (!VALID_STATES.includes(toState)) {
        console.error(`Invalid state: '${toState}'. Must be one of: ${VALID_STATES.join(', ')}`);
        process.exit(1);
      }

      const state = readState(changeDir);
      const fromState = state.state;

      // T3: warn-only divergence warning at top of transition (after reading state)
      warnIfDiverged(changeDir);

      // T3: divergence pre-check BEFORE guard for terminal transitions
      if ((toState === 'closing' || toState === 'abandoned') && state.worktree) {
        const d = divergence(changeDir);
        if (d.diverged) {
          console.error(`Refusing ${fromState} -> ${toState}: worktree copy at ${d.worktreePath} diverged from this change directory. Sync its artifacts back first, then retry.`);
          process.exit(1);
        }
      }

      // Run guard before allowing transition (H-2: enforce guard)
      const guardScript = join(__dirname, '..', 'guard', 'guard.mjs');
      // The guard runs from the bundled plugin directory. Resolve a relative
      // change path from the caller project before spawning it so both commands

      // inspect the same active change.

      const guardChangeDir = resolve(changeDir);
      const rawWorkflow = state.workflow || 'full';
      // Normalize: guard only accepts full/hotfix/tweak, not "auto"
      const workflow = rawWorkflow === 'auto' ? 'full' : rawWorkflow;
      const guardResult = spawnSync('node', [guardScript, 'check', guardChangeDir, fromState, toState, '--json', '--workflow', workflow], {
        cwd: join(__dirname, '..', '..'),
        timeout: 10_000,
      });

      const guardOutput = guardResult.stdout?.toString() ?? '';
      const guardStderr = guardResult.stderr?.toString().trim() ?? '';
      if (guardResult.error) {
        console.error(`Guard check failed for ${fromState} -> ${toState}:`);
        console.error(`  [guard-error] ${guardResult.error.message}`);
        if (guardStderr) console.error(`  ${guardStderr}`);
        process.exit(1);
      }

      let parsed;
      try {
        parsed = JSON.parse(guardOutput);
      } catch {
        console.error(`Guard check failed for ${fromState} -> ${toState}:`);
        console.error('  [guard-error] Guard did not return valid JSON.');
        if (guardStderr) console.error(`  ${guardStderr}`);
        process.exit(1);
      }

      if (guardResult.status !== 0 || parsed.pass !== true) {
        const failures = (parsed.checks || [])
          .filter(c => !c.pass)
          .flatMap(c => (c.failures || []).map(f => `[${c.dimension}] ${f}`));
        console.error(`Guard check failed for ${fromState} -> ${toState}:`);
        for (const f of failures) console.error(`  ${f}`);
        if (parsed.error) console.error(`  ${parsed.error}`);
        if (failures.length === 0 && !parsed.error) {
          console.error('  [guard-error] Guard failed without a structured failure message.');
        }
        process.exit(1);
      }

      state.state = toState;
      state.artifacts_hash = computeArtifactsHash(changeDir);
      state.contract_hash = computeContractHash(changeDir);
      state.last_transition_from = fromState;
      state.last_transition_to = toState;
      state.last_transition = new Date().toISOString();
      writeState(changeDir, state);

      // T3: automatic worktree cleanup after successful transition
      if ((toState === 'closing' || toState === 'abandoned') && state.worktree) {
        let worktreeAbs = join(repoRootFor(changeDir), state.worktree);
        let insideWorktree = false;
        try {
          const realChange = realpathSync(resolve(changeDir));
          const realWorktree = realpathSync(worktreeAbs);
          insideWorktree = realChange.startsWith(realWorktree + sep);
        } catch {
          // Fallback for inside-worktree case where worktreeAbs may be computed from wrong repo root
          try {
            const gitCommon = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: changeDir, encoding: 'utf-8' }).trim();
            const mainRoot = realpathSync(resolve(changeDir, gitCommon, '..'));
            const altWorktreeAbs = join(mainRoot, state.worktree);
            worktreeAbs = altWorktreeAbs;
            const realChange2 = realpathSync(resolve(changeDir));
            const realAlt = realpathSync(altWorktreeAbs);
            insideWorktree = realChange2.startsWith(realAlt + sep);
          } catch {
            insideWorktree = false;
          }
        }
        if (insideWorktree) {
          console.error(`warning: transition run from inside the worktree copy; skipping automatic worktree removal. Re-run cleanup from the main checkout: git worktree remove --force ${worktreeAbs}`);
        } else {
          if (!existsSync(worktreeAbs)) {
            try {
              state.worktree = null;
              writeState(changeDir, state);
            } catch (e) {
              console.error(`warning: failed to clear stale worktree pointer: ${(e.message || '').toString().trim()}`);
            }
          } else {
            let removalSucceeded = false;
            try {
              const repoRoot = repoRootFor(changeDir);
              execFileSync('git', ['worktree', 'remove', '--force', worktreeAbs], { cwd: repoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
              removalSucceeded = true;
            } catch (e) {
              console.error(`warning: automatic worktree removal failed: ${(e.stderr || e.message || '').toString().trim()}. Remove manually: git worktree remove --force ${worktreeAbs}`);
            }
            if (removalSucceeded) {
              try {
                state.worktree = null;
                writeState(changeDir, state);
              } catch (e) {
                console.error(`warning: failed to clear worktree pointer after removal: ${(e.message || '').toString().trim()}`);
              }
            }
          }
        }
      }

      // Auto-inject phase-guard after successful transition (H-3: keep phase-guard in sync)
      // Spawn as a subprocess: cmd-inject calls process.exit(2) when no platform
      // can be detected, which would otherwise abort this transition despite the
      // state already being persisted. The phase-guard can be manually refreshed
      // with `ssf inject` if auto-inject fails.
      try {
        spawnSync(process.execPath, [join(__dirname, '..', 'spec-superflow.mjs'), 'inject', changeDir, '--quiet'], {
          cwd: process.cwd(),
          stdio: 'ignore',
          timeout: 10_000,
        });
      } catch {
        // Non-fatal: phase-guard can be manually refreshed with `ssf inject`
      }

      if (values.json) {
        console.log(JSON.stringify({ ok: true, from: fromState, to: toState }));
      } else {
        console.log(`State transitioned: ${fromState} -> ${toState}`);
      }
      break;
    }
    case 'get': {
      const field = arg;
      if (!field) {
        console.error('Usage: ssf state get <change-dir> <field>');
        process.exit(2);
      }
      const state = readState(changeDir);
      if (!Object.prototype.hasOwnProperty.call(state, field) && field in state) {
        console.error(`Field '${field}' is not a valid state field`);
        process.exit(1);
      }
      const value = state[field];
      if (values.json) {
        console.log(JSON.stringify({ field, value: value ?? null }));
      } else {
        console.log(value ?? 'null');
      }
      break;
    }
    case 'rebuild': {
      const state = rebuildState(changeDir, { computeArtifactsHash, computeContractHash });
      if (values.json) {
        console.log(JSON.stringify({ ok: true, state: state.state }));
      } else {
        console.log(`State rebuilt from artifacts. state: ${state.state}`);
      }
      break;
    }
    case 'set': {
      // ssf state set <change-dir> <field> <value>
      const field = arg;
      const value = positionals[3];
      if (!field || value === undefined) {
        console.error('Usage: ssf state set <change-dir> <field> <value>');
        process.exit(2);
      }
      if (!SETTABLE_FIELDS.includes(field)) {
        console.error(`⛔ Field '${field}' is not settable (use 'transition' for state, or check SETTABLE_FIELDS)`);
        process.exit(1);
      }
      if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) {
        console.error('State field values must not contain control characters or line separators');
        process.exit(1);
      }
      updateField(changeDir, field, value);
      if (values.json) {
        console.log(JSON.stringify({ ok: true, field, value }));
      } else {
        console.log(`✅ Set ${field} = ${value}`);
      }
      break;
    }
    default:
      console.error(`Unknown subcommand: ${sub}. Valid: init, check, transition, get, rebuild, set`);
      process.exit(2);
  }
}
