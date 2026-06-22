// Pure pruning policy, kept free of any fs or vscode imports so it can be unit
// tested. Given the snapshot folders that exist (each flagged as a checkpoint
// or not) and the maximum number of automatic snapshots to keep, decide which
// folders to delete.
//
// Rules:
//   - Named checkpoints are intentional restore points and are never pruned.
//   - Only automatic snapshots count against `max`.
//   - The oldest automatic snapshots are pruned first. Folder names sort
//     chronologically (YYYYMMDD-HHmmss, with -N collision suffixes sorting
//     just after their base), so a plain ascending sort is oldest-first.
export interface SnapshotEntry {
  name: string;
  isCheckpoint: boolean;
}

export function selectSnapshotsToPrune(entries: SnapshotEntry[], max: number): string[] {
  const auto = entries
    .filter(e => !e.isCheckpoint)
    .map(e => e.name)
    .sort();
  const excess = Math.max(0, auto.length - Math.max(0, max));
  return auto.slice(0, excess);
}
