// Pure pruning policy, kept free of any fs or vscode imports so it can be unit
// tested. Given the snapshot folders that exist (each flagged as a checkpoint
// or not) and the maximum number of automatic snapshots to keep, decide which
// folders to delete.
//
// Rules:
//   - Named checkpoints are intentional restore points and are never pruned.
//   - Only automatic snapshots count against `max`.
//   - The oldest automatic snapshots are pruned first. compareSnapshotNames
//     orders names chronologically, treating the -N collision suffix as a
//     number so -10 sorts after -2 rather than before it.
import { compareSnapshotNames } from './snapshotOrder';

export interface SnapshotEntry {
  name: string;
  isCheckpoint: boolean;
}

// Whether a snapshot is a protected checkpoint that pruning must never delete.
// A manual checkpoint has a non-empty label and is protected. An automatic
// burst checkpoint also carries a label (so it reads clearly in the timeline)
// but sets auto:true and stays prunable, or heavy agent use would fill the
// store forever.
export function isProtectedCheckpoint(meta: { label?: string; auto?: boolean }): boolean {
  return typeof meta.label === 'string' && meta.label.length > 0 && meta.auto !== true;
}

export function selectSnapshotsToPrune(entries: SnapshotEntry[], max: number): string[] {
  const auto = entries
    .filter(e => !e.isCheckpoint)
    .map(e => e.name)
    .sort(compareSnapshotNames);
  const excess = Math.max(0, auto.length - Math.max(0, max));
  return auto.slice(0, excess);
}
