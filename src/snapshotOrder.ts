// A snapshot folder is named YYYYMMDD-HHmmss with an optional -N collision
// suffix (N starts at 2) appended when several snapshots land in the same
// second. The base is fixed-width so it sorts chronologically as a string, but
// the suffix is an unpadded integer: lexically "-10" sorts before "-2", which
// would order a later snapshot before an earlier one. Every place that orders
// snapshots by name must therefore split off the numeric suffix and compare it
// as a number, not as text, or pruning, diffing, and newest-first listing all
// go wrong once ten snapshots share a second (reachable through the headless
// API, which can snapshot many times in quick succession).
//
// Returns a negative number if a is older than b, positive if a is newer, and
// zero if they are equal. Suitable as an Array.prototype.sort comparator, which
// then orders oldest-first.
export function compareSnapshotNames(a: string, b: string): number {
  const [baseA, suffixA] = splitSnapshotName(a);
  const [baseB, suffixB] = splitSnapshotName(b);
  if (baseA < baseB) return -1;
  if (baseA > baseB) return 1;
  return suffixA - suffixB;
}

// Split a snapshot name into its timestamp base and numeric collision suffix.
// A name with no suffix gets suffix 0, so the unsuffixed base (the first
// snapshot of that second) sorts before its -2, -3, ... siblings. A name that
// does not match the expected shape is returned whole with suffix 0, falling
// back to a plain string comparison rather than throwing.
function splitSnapshotName(name: string): [string, number] {
  const m = /^(\d{8}-\d{6})-(\d+)$/.exec(name);
  if (m) return [m[1], Number(m[2])];
  return [name, 0];
}
