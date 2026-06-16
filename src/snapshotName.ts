// Snapshot folders are named by timestamp at second granularity
// (YYYYMMDD-HHmmss). Two snapshots taken in the same second would otherwise
// land in the same folder and silently overwrite each other's manifest. That
// is easy to hit through the headless API, where an agent may snapshot,
// checkpoint, or restore several times in quick succession.
//
// Given the base timestamp and the folder names already present, return a
// unique name, suffixing -2, -3, ... on collision. The suffix sorts after the
// base lexicographically, so newest-first ordering by name is preserved.
export function uniqueSnapshotName(base: string, taken: Iterable<string>): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
}
