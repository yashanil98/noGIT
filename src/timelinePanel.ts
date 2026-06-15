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
      } else if (msg?.type === 'checkpoint') {
        await vscode.commands.executeCommand('nogit.checkpoint');
        this.refresh();
      } else if (msg?.type === 'diff') {
        await this.openDiff(msg.ts, msg.rel);
      } else if (msg?.type === 'restoreFile') {
        await vscode.commands.executeCommand('nogit.restoreFile', msg.ts, msg.rel);
        this.refresh();
      } else if (msg?.type === 'restoreSnapshot') {
        await vscode.commands.executeCommand('nogit.restoreSnapshot', msg.ts);
        this.refresh();
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
      'noGIT Timeline',
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

  // Open the native diff editor comparing the snapshot version (left) against
  // the current working file (right).
  private async openDiff(ts: string, rel: string) {
    const snapPath = this.snapMgr.resolveSnapshotPath(ts, rel);
    const curPath = this.snapMgr.resolveWorkspacePath(rel);
    if (!snapPath || !curPath) return;
    const left = vscode.Uri.file(snapPath);
    const right = vscode.Uri.file(curPath);
    const title = `${rel} (${this.formatTimestamp(ts)} ↔ current)`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
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
        <title>noGIT Timeline</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 12px; }
          .ts { font-weight: 600; margin-top: 14px; display: flex; justify-content: space-between; align-items: center; }
          .file { font-family: monospace; padding: 4px 0; display: flex; justify-content: space-between; align-items: center; }
          .file span:last-child { display: flex; gap: 6px; }
          button { border: 1px solid var(--vscode-button-border, #888); padding: 2px 8px; border-radius: 6px; cursor: pointer; }
          .empty { opacity: 0.7; font-style: italic; }
          .badge { font-weight: 400; font-size: 0.85em; padding: 1px 6px; margin-left: 6px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }
          .hdr { display:flex; justify-content: space-between; align-items:center; margin-bottom: 6px; }
        </style>
      </head>
      <body>
        <div class="hdr">
          <h2>noGIT Timeline</h2>
          <span>
            <button id="checkpoint">Checkpoint</button>
            <button id="refresh">Refresh</button>
          </span>
        </div>
        ${snapshots.length === 0 ? `<div class="empty">No snapshots yet. Make some edits or run <code>noGIT: Snapshot Now</code>.</div>` : ''}
        ${snapshots.map(s => `
          <div class="snap">
            <div class="ts">
              <span>${this.escapeHtml(this.formatTimestamp(s.timestamp))}${s.label ? ` <span class="badge">${this.escapeHtml(s.label)}</span>` : ''}</span>
              <button data-ts="${this.escapeHtml(s.timestamp)}" class="restore-snap">Restore all</button>
            </div>
            ${s.files.map(rel => `
              <div class="file">
                <span>${this.escapeHtml(rel)}</span>
                <span>
                  <button data-ts="${this.escapeHtml(s.timestamp)}" data-rel="${this.escapeHtml(rel)}" class="open">Open</button>
                  <button data-ts="${this.escapeHtml(s.timestamp)}" data-rel="${this.escapeHtml(rel)}" class="diff">Diff</button>
                  <button data-ts="${this.escapeHtml(s.timestamp)}" data-rel="${this.escapeHtml(rel)}" class="restore">Restore</button>
                </span>
              </div>
            `).join('') || '<div class="empty">No files captured in this snapshot.</div>'}
          </div>
        `).join('')}
        <script>
          const vscode = acquireVsCodeApi();
          const send = (type, btn) => vscode.postMessage({
            type,
            ts: btn.getAttribute('data-ts'),
            rel: btn.getAttribute('data-rel'),
          });
          document.querySelectorAll('.open').forEach(btn =>
            btn.addEventListener('click', () => send('openPreview', btn)));
          document.querySelectorAll('.diff').forEach(btn =>
            btn.addEventListener('click', () => send('diff', btn)));
          document.querySelectorAll('.restore').forEach(btn =>
            btn.addEventListener('click', () => send('restoreFile', btn)));
          document.querySelectorAll('.restore-snap').forEach(btn =>
            btn.addEventListener('click', () => send('restoreSnapshot', btn)));
          document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
          document.getElementById('checkpoint')?.addEventListener('click', () => vscode.postMessage({ type: 'checkpoint' }));
        </script>
      </body>
      </html>
    `;
    this.panel.webview.html = html;
  }

  // Turn a YYYYMMDD-HHmmss stamp into a readable "YYYY-MM-DD HH:MM:SS".
  // Falls back to the raw value if it does not match the expected shape.
  private formatTimestamp(ts: string): string {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts);
    if (!m) return ts;
    const [, y, mo, d, h, mi, s] = m;
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
