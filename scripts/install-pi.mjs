// Archived: non-DSH platform, DSH-only distribution
// Original archived to docs/archive/non-dsh-platforms/scripts/install-pi.mjs
// This placeholder preserves path for compatibility. DSH-only distribution does not provide this installer.

export async function run(args, opts) {
  const stderr = opts?.stderr ?? process.stderr;
  stderr.write('Archived: scripts/install-pi.mjs is a non-DSH platform installer, removed in DSH-only distribution. See docs/archive/non-dsh-platforms/scripts/install-pi.mjs\n');
  return { exitCode: 0 };
}
