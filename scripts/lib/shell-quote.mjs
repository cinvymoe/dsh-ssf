// Quote one value for a POSIX shell command embedded in a skill instruction.
export function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
