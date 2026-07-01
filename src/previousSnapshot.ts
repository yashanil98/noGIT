// Snapshots that capture a given file, needed to diff one version against the
// one before it. Only the timestamp and file list matter here, so this stays a
// pure function over plain data and can be unit tested without vscode or the
// filesystem.
export interface SnapshotFiles {
  timestamp: string;
  files: string[];
}

// Given all snapshots (in any order) and a reference timestamp, return the
// timestamp of the most recent snapshot OLDER than the reference that also
// captured `rel`, or undefined when there is no earlier version. Timestamps
// sort lexicographically in chronological order (YYYYMMDD-HHmmss with an
// optional -N suffix), so "older" is a straight string comparison.
export function findPreviousSnapshotWithFile(
  snapshots: SnapshotFiles[],
  ts: string,
  rel: string,
): string | undefined {
  let best: string | undefined;
  for (const s of snapshots) {
    if (s.timestamp >= ts) continue;        // same snapshot or newer
    if (!s.files.includes(rel)) continue;   // did not capture this file
    if (best === undefined || s.timestamp > best) best = s.timestamp;
  }
  return best;
}
