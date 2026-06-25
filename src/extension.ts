// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';
import { TimelinePanel } from './timelinePanel';
import { NoGitApi, API_VERSION } from './api';
import { formatStamp } from './relativeTime';

let snapshotMgr: SnapshotManager | undefined;

export function activate(context: vscode.ExtensionContext): NoGitApi {
  console.log('noGIT activated');

  snapshotMgr = new SnapshotManager(context);
  snapshotMgr.start();

  context.subscriptions.push(
    vscode.commands.registerCommand('nogit.showTimeline', async () => {
      if (!snapshotMgr) return;
      await TimelinePanel.show(context, snapshotMgr);
    }),
    vscode.commands.registerCommand('nogit.snapshotNow', async () => {
      if (!snapshotMgr) return;
      await snapshotMgr.snapshotNow(true);
    }),
    vscode.commands.registerCommand('nogit.checkpoint', async (label?: string) => {
      if (!snapshotMgr) return;
      const name = label ?? await vscode.window.showInputBox({
        prompt: 'Name this checkpoint',
        placeHolder: 'e.g. before agent refactor',
      });
      if (!name?.trim()) return;
      await snapshotMgr.checkpoint(name);
    }),
    vscode.commands.registerCommand('nogit.restoreFile', async (ts?: string, rel?: string) => {
      if (!snapshotMgr || !ts || !rel) return;
      const choice = await vscode.window.showWarningMessage(
        `Restore ${rel} from the snapshot taken ${formatStamp(ts)}? Your current version is snapshotted first so this can be undone.`,
        { modal: true },
        'Restore'
      );
      if (choice !== 'Restore') return;
      await snapshotMgr.restoreFile(ts, rel);
    }),
    vscode.commands.registerCommand('nogit.restoreSnapshot', async (ts?: string) => {
      if (!snapshotMgr || !ts) return;
      const choice = await vscode.window.showWarningMessage(
        `Restore all files from the snapshot taken ${formatStamp(ts)}? Your current versions are snapshotted first so this can be undone.`,
        { modal: true },
        'Restore all files'
      );
      if (choice !== 'Restore all files') return;
      await snapshotMgr.restoreSnapshot(ts);
    }),
    vscode.commands.registerCommand('nogit.deleteSnapshot', async (ts?: string) => {
      if (!snapshotMgr || !ts) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete the snapshot taken ${formatStamp(ts)}? This permanently removes its stored files and cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (choice !== 'Delete') return;
      await snapshotMgr.deleteSnapshot(ts);
    }),
  );

  // Public API for other extensions and agents. These call the manager
  // directly and never prompt, so they are safe to use headlessly.
  const api: NoGitApi = {
    version: API_VERSION,
    snapshotNow: () => snapshotMgr?.snapshotNow() ?? Promise.resolve(),
    checkpoint: (label: string) => snapshotMgr?.checkpoint(label) ?? Promise.resolve(0),
    listSnapshots: () => snapshotMgr?.listSnapshots() ?? Promise.resolve([]),
    restoreFile: (ts: string, rel: string) => snapshotMgr?.restoreFile(ts, rel) ?? Promise.resolve(false),
    restoreSnapshot: (ts: string) => snapshotMgr?.restoreSnapshot(ts) ?? Promise.resolve(0),
    deleteSnapshot: (ts: string) => snapshotMgr?.deleteSnapshot(ts) ?? Promise.resolve(false),
  };
  return api;
}

export async function deactivate() {
  // Capture any edits made since the last interval tick before shutting down,
  // so closing the window does not lose work. snapshotNow is a no-op when
  // nothing is pending.
  try {
    await snapshotMgr?.snapshotNow();
  } finally {
    snapshotMgr?.dispose();
  }
}
