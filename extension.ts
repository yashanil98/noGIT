// The module 'vscode' contains the VS Code extensibility API
import * as vscode from 'vscode';
import { SnapshotManager } from './snapshotManager';
import { TimelinePanel } from './timelinePanel';

let snapshotMgr: SnapshotManager | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log('noGit activated');

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
    { dispose: () => snapshotMgr?.dispose() }
  );
}

export function deactivate() {
  snapshotMgr?.dispose();
}
