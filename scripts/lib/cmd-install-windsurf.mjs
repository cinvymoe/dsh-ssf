// Archived: non-DSH platform, DSH-only distribution
// Original archived to docs/archive/non-dsh-platforms/scripts/lib/cmd-install-windsurf.mjs

export async function run(args, opts) {
  const stderr = opts?.stderr ?? process.stderr;
  stderr.write('Archived: scripts/lib/cmd-install-windsurf.mjs is a non-DSH platform installer, removed in DSH-only distribution. See docs/archive/non-dsh-platforms/scripts/lib/cmd-install-windsurf.mjs\n');
  return { exitCode: 0 };
}
