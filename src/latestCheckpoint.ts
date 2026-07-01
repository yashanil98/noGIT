// The most recent checkpoint (a snapshot with a non-empty label) from a list.
// Only the timestamp and label matter, so this is a pure function over plain
// data, testable without vscode or the filesystem.
export interface LabelledSnapshot {
  timestamp: string;
  label?: string;
}

// Return the checkpoint with the newest timestamp, or undefined when there are
// no checkpoints. Timestamps sort lexicographically in chronological order
// (YYYYMMDD-HHmmss with an optional -N suffix), so "newest" is a plain string
// comparison and the input need not be pre-sorted.
export function findLatestCheckpoint<T extends LabelledSnapshot>(snapshots: T[]): T | undefined {
  let best: T | undefined;
  for (const s of snapshots) {
    if (!s.label || s.label.length === 0) continue;
    if (best === undefined || s.timestamp > best.timestamp) best = s;
  }
  return best;
}
