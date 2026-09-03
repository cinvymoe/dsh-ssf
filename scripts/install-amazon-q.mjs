// Archived: non-DSH platform, DSH-only distribution
// Original archived to docs/archive/non-dsh-platforms/scripts/install-amazon-q.mjs
// This placeholder preserves path for compatibility. DSH-only distribution does not provide this installer.

export async function run(args, opts) {
  const stderr = opts?.stderr ?? process.stderr;
  stderr.write('Archived: scripts/install-amazon-q.mjs is a non-DSH platform installer, removed in DSH-only distribution. See docs/archive/non-dsh-platforms/scripts/install-amazon-q.mjs\n');
  return { exitCode: 0 };
}
