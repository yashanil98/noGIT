import { SnapshotInfo } from './snapshotManager';

// Public API surface returned from activate(). Other extensions reach it with:
//
//   const ext = vscode.extensions.getExtension('yashanil98.nogit');
//   const api: NoGitApi | undefined = ext?.exports;
//   await api?.checkpoint('before agent run');
//
// This lets AI coding agents and other tools create restore points and roll
// back programmatically, without going through the UI.
export interface NoGitApi {
  // Semver of the API shape. Bumped only on breaking changes.
  readonly version: string;

  // Snapshot the files modified since the last snapshot. No-op if none.
  snapshotNow(): Promise<void>;

  // Capture a named checkpoint of the entire workspace. Returns the number of
  // files captured.
  checkpoint(label: string): Promise<number>;

  // List snapshots and checkpoints, newest first.
  listSnapshots(): Promise<SnapshotInfo[]>;

  // Restore a single file from a snapshot. The current contents are snapshotted
  // first so the restore is itself reversible. Returns true on success.
  restoreFile(timestamp: string, relPath: string): Promise<boolean>;

  // Restore every file in a snapshot. Returns the number of files restored.
  restoreSnapshot(timestamp: string): Promise<number>;

  // Delete a snapshot or checkpoint from the store. This is permanent and is
  // not itself reversible. Returns true if a folder was removed. Added in API
  // 1.1.0.
  deleteSnapshot(timestamp: string): Promise<boolean>;
}

export const API_VERSION = '1.1.0';
