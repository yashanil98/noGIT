import * as vscode from 'vscode';
import * as path from 'path';
import { SnapshotManager, SnapshotInfo } from './snapshotManager';

export class TimelinePanel {
  public static current: TimelinePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, private context: vscode.ExtensionContext, private snapshots: SnapshotInfo[], private snapMgr: SnapshotManager) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'openPreview') {
        const p = this.snapMgr.resolveSnapshotPath(msg.ts, msg.rel);
        if (!p) return;
        const uri = vscode.Uri.file(p);
        await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
      } else if (msg?.type === 'refresh') {
        this.refresh();
      }
    }, null, this.disposables);

    this.render();
  }

  public static async show(context: vscode.ExtensionContext, snapMgr: SnapshotManager) {
    const snapshots = await snapMgr.listSnapshots();
    const panel = vscode.window.createWebviewPanel(
      'nogitTimeline',
      'noGit Timeline',
      vscode.ViewColumn.Two,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    TimelinePanel.current = new TimelinePanel(panel, context, snapshots, snapMgr);
  }

  public dispose() {
    TimelinePanel.current = undefined;
    this.disposables.forEach(d => d.dispose());
  }

  private async refresh() {
    this.snapshots = await this.snapMgr.listSnapshots();
    this.render();
  }

  private render() {
    const webview = this.panel.webview;
    const snapshots = this.snapshots;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'unsafe-inline' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource};" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>noGit Timeline</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 12px; }
          .ts { font-weight: 600; margin-top: 10px; }
          .file { font-family: monospace; padding: 4px 0; display: flex; justify-content: space-between; }
          button { border: 1px solid var(--vscode-button-border, #888); padding: 2px 8px; border-radius: 6px; cursor: pointer; }
          .empty { opacity: 0.7; font-style: italic; }
          .hdr { display:flex; justify-content: space-between; align-items:center; margin-bottom: 6px; }
        </style>
      </head>
      <body>
        <div class="hdr">
          <h2>noGit Timeline</h2>
          <button id="refresh">Refresh</button>
        </div>
        ${snapshots.length === 0 ? `<div class="empty">No snapshots yet. Make some edits or run <code>noGit: Snapshot Now</code>.</div>` : ''}
        ${snapshots.map(s => `
          <div class="ts">📌 ${s.timestamp}</div>
          <div>
            ${s.files.map(rel => `
              <div class="file">
                <span>${rel}</span>
                <span>
                  <button data-ts="${s.timestamp}" data-rel="${rel}" class="open">Open</button>
                </span>
              </div>
            `).join('') || '<div class="empty">No files captured in this snapshot.</div>'}
          </div>
        `).join('')}
        <script>
          const vscode = acquireVsCodeApi();
          document.querySelectorAll('.open').forEach(btn => {
            btn.addEventListener('click', () => {
              const ts = btn.getAttribute('data-ts');
              const rel = btn.getAttribute('data-rel');
              vscode.postMessage({ type: 'openPreview', ts, rel });
            });
          });
          document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
        </script>
      </body>
      </html>
    `;
    this.panel.webview.html = html;
  }
}
