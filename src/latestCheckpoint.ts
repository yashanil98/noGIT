// The most recent checkpoint (a snapshot with a non-empty label) from a list.
// Only the timestamp and label matter, so this is a pure function over plain
// data, testable without vscode or the filesystem.
import { compareSnapshotNames } from './snapshotOrder';

export interface LabelledSnapshot {
  timestamp: string;
  label?: string;
}

// Return the checkpoint with the newest timestamp, or undefined when there are
// no checkpoints. compareSnapshotNames orders timestamps chronologically,
// treating the -N collision suffix numerically so "newest" stays correct within
// a single second, and the input need not be pre-sorted.
export function findLatestCheckpoint<T extends LabelledSnapshot>(snapshots: T[]): T | undefined {
  let best: T | undefined;
  for (const s of snapshots) {
    if (!s.label || s.label.length === 0) continue;
    if (best === undefined || compareSnapshotNames(s.timestamp, best.timestamp) > 0) best = s;
  }
  return best;
}
