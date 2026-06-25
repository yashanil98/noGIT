import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SnapshotManager, SnapshotInfo } from './snapshotManager';
import { relativeTime, formatStamp } from './relativeTime';
import { escapeHtml } from './html';

export class TimelinePanel {
  public static current: TimelinePanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, private context: vscode.ExtensionContext, private snapshots: SnapshotInfo[], private snapMgr: SnapshotManager) {
    this.panel = panel;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Refresh when snapshots change in the background (a timer snapshot, an
    // API call, or a delete), so the panel stays current without a click.
    this.snapMgr.onDidChangeSnapshots(() => this.refresh(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      // The webview is a lower-trust boundary. Accept only a string type and
      // treat ts/rel as strings or nothing, so a malformed message can never
      // reach a path or command with an unexpected shape.
      if (!msg || typeof msg.type !== 'string') return;
      const ts = typeof msg.ts === 'string' ? msg.ts : undefined;
      const rel = typeof msg.rel === 'string' ? msg.rel : undefined;

      if (msg.type === 'openPreview') {
        if (!ts || !rel) return;
        const p = await this.snapMgr.resolveSnapshotPath(ts, rel);
        if (!p) return;
        const uri = vscode.Uri.file(p);
        await vscode.commands.executeCommand('vscode.open', uri, { preview: true });
      } else if (msg.type === 'checkpoint') {
        await vscode.commands.executeCommand('nogit.checkpoint');
        this.refresh();
      } else if (msg.type === 'diff') {
        if (!ts || !rel) return;
        await this.openDiff(ts, rel);
      } else if (msg.type === 'restoreFile') {
        if (!ts || !rel) return;
        await vscode.commands.executeCommand('nogit.restoreFile', ts, rel);
        this.refresh();
      } else if (msg.type === 'restoreSnapshot') {
        if (!ts) return;
        await vscode.commands.executeCommand('nogit.restoreSnapshot', ts);
        this.refresh();
      } else if (msg.type === 'deleteSnapshot') {
        if (!ts) return;
        await vscode.commands.executeCommand('nogit.deleteSnapshot', ts);
        this.refresh();
      } else if (msg.type === 'refresh') {
        this.refresh();
      }
    }, null, this.disposables);

    this.render();
  }

  public static async show(context: vscode.ExtensionContext, snapMgr: SnapshotManager) {
    // Reuse the existing panel if one is already open. Creating a new panel
    // each time would orphan the previous one along with its change-event
    // subscription. Running the command again just brings the panel forward.
    if (TimelinePanel.current) {
      TimelinePanel.current.panel.reveal(vscode.ViewColumn.Two);
      await TimelinePanel.current.refresh();
      return;
    }
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
  // the current working file (right). When the current file no longer exists
  // (a common case after an agent deletes it), a diff would just show a "file
  // not found" pane, so open the snapshot version read-only instead and point
  // the user at Restore.
  private async openDiff(ts: string, rel: string) {
    const snapPath = await this.snapMgr.resolveSnapshotPath(ts, rel);
    const curPath = this.snapMgr.resolveWorkspacePath(rel);
    if (!snapPath || !curPath) return;
    const left = vscode.Uri.file(snapPath);
    const right = vscode.Uri.file(curPath);

    let currentExists = true;
    try {
      await vscode.workspace.fs.stat(right);
    } catch {
      currentExists = false;
    }

    if (!currentExists) {
      await vscode.commands.executeCommand('vscode.open', left, { preview: true });
      vscode.window.showInformationMessage(
        `${rel} no longer exists in the workspace. Showing the snapshot version. Use Restore to bring it back.`
      );
      return;
    }

    const title = `${rel} (${formatStamp(ts)} vs current)`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  private render() {
    const webview = this.panel.webview;
    const snapshots = this.snapshots;
    const now = Date.now();
    // A per-render nonce lets the one inline script run while keeping a strict
    // script-src, so any future unescaped interpolation cannot execute as a
    // script the way 'unsafe-inline' would allow.
    const nonce = crypto.randomBytes(16).toString('hex');

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' ${webview.cspSource};" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>noGIT Timeline</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 12px; }
          .ts { font-weight: 600; margin-top: 14px; display: flex; justify-content: space-between; align-items: center; }
          .ts span:last-child { display: flex; gap: 6px; }
          .file { font-family: monospace; padding: 4px 0; display: flex; justify-content: space-between; align-items: center; }
          .file span:last-child { display: flex; gap: 6px; }
          button { border: 1px solid var(--vscode-button-border, #888); padding: 2px 8px; border-radius: 6px; cursor: pointer; }
          .empty { opacity: 0.7; font-style: italic; }
          .badge { font-weight: 400; font-size: 0.85em; padding: 1px 6px; margin-left: 6px; border-radius: 8px; background: var(--vscode-badge-background, #4d4d4d); color: var(--vscode-badge-foreground, #fff); }
          .rel { font-weight: 400; font-size: 0.85em; opacity: 0.7; margin-left: 8px; }
          .count { font-weight: 400; font-size: 0.85em; opacity: 0.7; margin-left: 8px; }
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
              <span>${escapeHtml(formatStamp(s.timestamp))}<span class="rel">${escapeHtml(relativeTime(s.timestamp, now))}</span><span class="count">${this.fileCountLabel(s.files.length)}</span>${s.label ? ` <span class="badge">${escapeHtml(s.label)}</span>` : ''}</span>
              <span>
                <button data-ts="${escapeHtml(s.timestamp)}" class="restore-snap">Restore all</button>
                <button data-ts="${escapeHtml(s.timestamp)}" class="delete-snap">Delete</button>
              </span>
            </div>
            ${s.files.map(rel => `
              <div class="file">
                <span>${escapeHtml(rel)}</span>
                <span>
                  <button data-ts="${escapeHtml(s.timestamp)}" data-rel="${escapeHtml(rel)}" class="open">Open</button>
                  <button data-ts="${escapeHtml(s.timestamp)}" data-rel="${escapeHtml(rel)}" class="diff">Diff</button>
                  <button data-ts="${escapeHtml(s.timestamp)}" data-rel="${escapeHtml(rel)}" class="restore">Restore</button>
                </span>
              </div>
            `).join('') || '<div class="empty">No files captured in this snapshot.</div>'}
          </div>
        `).join('')}
        <script nonce="${nonce}">
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
          document.querySelectorAll('.delete-snap').forEach(btn =>
            btn.addEventListener('click', () => send('deleteSnapshot', btn)));
          document.getElementById('refresh')?.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
          document.getElementById('checkpoint')?.addEventListener('click', () => vscode.postMessage({ type: 'checkpoint' }));
        </script>
      </body>
      </html>
    `;
    this.panel.webview.html = html;
  }

  // "1 file" or "N files". Already plain text, so it needs no escaping.
  private fileCountLabel(n: number): string {
    return `${n} ${n === 1 ? 'file' : 'files'}`;
  }

}
