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
    vscode.commands.registerCommand('nogit.restoreLatestCheckpoint', async () => {
      if (!snapshotMgr) return;
      const latest = await snapshotMgr.latestCheckpoint();
      if (!latest) {
        vscode.window.showInformationMessage('noGIT: no checkpoint to restore. Create one with noGIT: Create Checkpoint.');
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Restore the latest checkpoint "${latest.label}" taken ${formatStamp(latest.timestamp)}? Your current versions are snapshotted first so this can be undone.`,
        { modal: true },
        'Restore checkpoint'
      );
      if (choice !== 'Restore checkpoint') return;
      await snapshotMgr.restoreSnapshot(latest.timestamp);
    }),
    vscode.commands.registerCommand('nogit.restoreLatestCheckpointExact', async () => {
      if (!snapshotMgr) return;
      const latest = await snapshotMgr.latestCheckpoint();
      if (!latest) {
        vscode.window.showInformationMessage('noGIT: no checkpoint to restore. Create one with noGIT: Create Checkpoint.');
        return;
      }
      const deleteCount = await snapshotMgr.exactRestoreDeleteCount(latest.timestamp) ?? 0;
      const deletePart = deleteCount > 0
        ? `This will DELETE ${deleteCount} file(s) added since the checkpoint. `
        : 'No files have been added since, so nothing will be deleted. ';
      const choice = await vscode.window.showWarningMessage(
        `Exactly restore the latest checkpoint "${latest.label}" taken ${formatStamp(latest.timestamp)}? ${deletePart}Your current files are snapshotted first so this can be undone.`,
        { modal: true },
        'Restore exactly'
      );
      if (choice !== 'Restore exactly') return;
      await snapshotMgr.restoreCheckpointExact(latest.timestamp);
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
  // directly and never prompt, so the integrator owns any confirmation.
  const mgr = snapshotMgr;
  const api: NoGitApi = {
    version: API_VERSION,
    snapshotNow: () => mgr.snapshotNow(),
    checkpoint: (label: string) => mgr.checkpoint(label),
    listSnapshots: () => mgr.listSnapshots(),
    latestCheckpoint: () => mgr.latestCheckpoint(),
    restoreFile: (ts: string, rel: string) => mgr.restoreFile(ts, rel),
    restoreSnapshot: (ts: string) => mgr.restoreSnapshot(ts),
    deleteSnapshot: (ts: string) => mgr.deleteSnapshot(ts),
    onDidChangeSnapshots: mgr.onDidChangeSnapshots,
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
