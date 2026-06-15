// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';
import { TimelinePanel } from './timelinePanel';

let snapshotMgr: SnapshotManager | undefined;

export function activate(context: vscode.ExtensionContext) {
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
      await snapshotMgr.snapshotNow();
    }),
    vscode.commands.registerCommand('nogit.checkpoint', async (label?: string) => {
      if (!snapshotMgr) return;
      const name = label ?? await vscode.window.showInputBox({
        prompt: 'Name this checkpoint',
        placeHolder: 'e.g. before agent refactor',
      });
      if (!name) return;
      await snapshotMgr.checkpoint(name);
    }),
    vscode.commands.registerCommand('nogit.restoreFile', async (ts?: string, rel?: string) => {
      if (!snapshotMgr || !ts || !rel) return;
      const choice = await vscode.window.showWarningMessage(
        `Restore ${rel} from snapshot ${ts}? Your current version is snapshotted first so this can be undone.`,
        { modal: true },
        'Restore'
      );
      if (choice !== 'Restore') return;
      await snapshotMgr.restoreFile(ts, rel);
    }),
    vscode.commands.registerCommand('nogit.restoreSnapshot', async (ts?: string) => {
      if (!snapshotMgr || !ts) return;
      const choice = await vscode.window.showWarningMessage(
        `Restore all files from snapshot ${ts}? Your current versions are snapshotted first so this can be undone.`,
        { modal: true },
        'Restore All'
      );
      if (choice !== 'Restore All') return;
      await snapshotMgr.restoreSnapshot(ts);
    }),
    { dispose: () => snapshotMgr?.dispose() }
  );
}

export function deactivate() {
  snapshotMgr?.dispose();
}
