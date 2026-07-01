import type * as vscode from 'vscode';
import { SnapshotInfo } from './snapshotManager';

// Public API surface returned from activate(). Other extensions reach it with:
//
//   const ext = vscode.extensions.getExtension('yashanil98.nogit');
//   const api: NoGitApi | undefined = ext?.exports;
//   await api?.checkpoint('before agent run');
//
// This lets AI coding agents and other tools create restore points and roll
// back programmatically, without going through the UI.
//
// Safety contract: the destructive calls (restoreFile, restoreSnapshot,
// deleteSnapshot) run WITHOUT any confirmation prompt, unlike the equivalent
// commands in the UI. An integrator that exposes them to an agent owns any
// confirmation. restoreFile and restoreSnapshot snapshot the current state
// first, so they are reversible; deleteSnapshot is not.
export interface NoGitApi {
  // Semver of the API shape. Bumped on additive or breaking changes.
  readonly version: string;

  // Snapshot the files modified since the last snapshot. Returns the new
  // snapshot's timestamp, or undefined when there was nothing to capture, so a
  // caller can tell whether a snapshot was actually written.
  snapshotNow(): Promise<string | undefined>;

  // Capture a named checkpoint of the entire workspace. Returns the number of
  // files captured.
  checkpoint(label: string): Promise<number>;

  // List snapshots and checkpoints, newest first.
  listSnapshots(): Promise<SnapshotInfo[]>;

  // The most recent checkpoint (a labelled snapshot), or undefined when there
  // is none. An agent can pair this with restoreSnapshot to roll back to the
  // point before its run. Added in API 1.3.0.
  latestCheckpoint(): Promise<SnapshotInfo | undefined>;

  // Restore a single file from a snapshot. The current contents are snapshotted
  // first so the restore is itself reversible. Returns true on success. Runs
  // without a prompt.
  restoreFile(timestamp: string, relPath: string): Promise<boolean>;

  // Restore every file captured in a snapshot back to its snapshot contents.
  // This is additive: it re-creates the captured files but does not delete
  // files added since the snapshot. Returns the number of files restored. Runs
  // without a prompt.
  restoreSnapshot(timestamp: string): Promise<number>;

  // Delete a snapshot or checkpoint from the store. This is permanent, is NOT
  // reversible, runs without a prompt, and does not spare labelled checkpoints,
  // so a caller must do its own confirmation. Returns true if a folder was
  // removed. Added in API 1.1.0.
  deleteSnapshot(timestamp: string): Promise<boolean>;

  // Fires whenever the stored snapshots change (a snapshot written or deleted),
  // so an agent can react to background snapshots without polling. Added in API
  // 1.2.0.
  readonly onDidChangeSnapshots: vscode.Event<void>;
}

export const API_VERSION = '1.3.0';
