// Snapshots that capture a given file, needed to diff one version against the
// one before it. Only the timestamp and file list matter here, so this stays a
// pure function over plain data and can be unit tested without vscode or the
// filesystem.
import { compareSnapshotNames } from './snapshotOrder';

export interface SnapshotFiles {
  timestamp: string;
  files: string[];
}

// Given all snapshots (in any order) and a reference timestamp, return the
// timestamp of the most recent snapshot OLDER than the reference that also
// captured `rel`, or undefined when there is no earlier version.
// compareSnapshotNames orders timestamps chronologically, treating the -N
// collision suffix numerically so "older" stays correct within a single second.
export function findPreviousSnapshotWithFile(
  snapshots: SnapshotFiles[],
  ts: string,
  rel: string,
): string | undefined {
  let best: string | undefined;
  for (const s of snapshots) {
    if (compareSnapshotNames(s.timestamp, ts) >= 0) continue;  // same or newer
    if (!s.files.includes(rel)) continue;   // did not capture this file
    if (best === undefined || compareSnapshotNames(s.timestamp, best) > 0) best = s.timestamp;
  }
  return best;
}
