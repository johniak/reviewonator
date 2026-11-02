const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

export function compareVersions(left: string, right: string): -1 | 0 | 1 {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function parse(version: string): number[] {
  const match = version.match(VERSION);
  if (!match) throw new Error(`Unsupported version: ${version}`);
  return match.slice(1).map(Number);
}
