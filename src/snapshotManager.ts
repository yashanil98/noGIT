import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SnapshotInfo {
  timestamp: string;            // YYYYMMDD-HHmmss
  files: string[];              // relative paths
}

export class SnapshotManager {
  private context: vscode.ExtensionContext;
  private timer: NodeJS.Timeout | undefined;
  private modified: Set<string> = new Set(); // relative paths within workspace
  private workspaceFolder: vscode.WorkspaceFolder | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!this.workspaceFolder) {
      vscode.window.showWarningMessage('noGit: Open a folder/workspace to enable snapshots.');
      return;
    }

    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme !== 'file') return;
      const rel = this.toRel(e.document.uri.fsPath);
      if (!rel) return;
      if (this.shouldExclude(rel)) return;
      this.modified.add(rel);
    }, null, this.context.subscriptions);

    vscode.workspace.onDidSaveTextDocument(doc => {
      if (doc.uri.scheme !== 'file') return;
      const rel = this.toRel(doc.uri.fsPath);
      if (!rel) return;
      if (this.shouldExclude(rel)) return;
      this.modified.add(rel);
    }, null, this.context.subscriptions);

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('nogit')) {
        this.restartTimer();
      }
    }, null, this.context.subscriptions);
  }

  public start() {
    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    if (!enabled || !this.workspaceFolder) return;
    this.restartTimer();
  }

  public dispose() {
    if (this.timer) clearInterval(this.timer);
  }

  public async snapshotNow() {
    if (!this.workspaceFolder) return;
    const items = Array.from(this.modified);
    this.modified.clear();

    if (items.length === 0) return; // nothing changed

    const ts = this.makeTimestamp();
    const snapRoot = await this.getSnapshotsRoot();
    const snapDir = path.join(snapRoot, ts);

    await fs.mkdir(snapDir, { recursive: true });

    const copied: string[] = [];
    for (const rel of items) {
      try {
        const abs = path.join(this.workspaceFolder.uri.fsPath, rel);
        const dest = path.join(snapDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const data = await fs.readFile(abs);
        await fs.writeFile(dest, data);
        copied.push(rel);
      } catch (err) {
        console.error('noGit copy failed for', rel, err);
      }
    }

    // write manifest
    const manifest: SnapshotInfo = { timestamp: ts, files: copied };
    await fs.writeFile(path.join(snapDir, 'meta.json'), JSON.stringify(manifest, null, 2), 'utf8');

    // prune
    await this.pruneOldSnapshots();

    // notify
    vscode.window.setStatusBarMessage(`noGit snapshot saved (${copied.length} files)`, 3000);
  }

  public async listSnapshots(): Promise<SnapshotInfo[]> {
    const root = await this.getSnapshotsRoot();
    let dirs: string[] = [];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort().reverse();
    } catch {
      return [];
    }
    const results: SnapshotInfo[] = [];
    for (const d of dirs) {
      try {
        const meta = JSON.parse(await fs.readFile(path.join(root, d, 'meta.json'), 'utf8')) as SnapshotInfo;
        results.push(meta);
      } catch {
        // ignore broken snapshot
      }
    }
    return results;
  }

  public resolveSnapshotPath(ts: string, relPath: string): string | undefined {
    if (!this.workspaceFolder) return undefined;
    return path.join(this.workspaceFolder.uri.fsPath, this.snapshotFolderName(), 'snapshots', ts, relPath);
  }

  private async pruneOldSnapshots() {
    const root = await this.getSnapshotsRoot();
    const max = vscode.workspace.getConfiguration('nogit').get<number>('maxSnapshots', 48);
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
      const excess = Math.max(0, dirs.length - max);
      for (let i = 0; i < excess; i++) {
        const dir = path.join(root, dirs[i]);
        await fs.rm(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  private async getSnapshotsRoot(): Promise<string> {
    if (!this.workspaceFolder) throw new Error('No workspace');
    const root = path.join(this.workspaceFolder.uri.fsPath, this.snapshotFolderName(), 'snapshots');
    await fs.mkdir(root, { recursive: true });
    return root;
  }

  private snapshotFolderName(): string {
    return vscode.workspace.getConfiguration('nogit').get<string>('snapshotFolderName', '.nogit');
  }

  private restartTimer() {
    if (this.timer) clearInterval(this.timer);
    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    if (!enabled || !this.workspaceFolder) return;
    const minutes = vscode.workspace.getConfiguration('nogit').get<number>('snapshotIntervalMinutes', 10);
    const intervalMs = Math.max(1, minutes) * 60 * 1000;

    // immediate snapshot scheduling is not needed; timer triggers periodically
    this.timer = setInterval(() => {
      this.snapshotNow();
    }, intervalMs);
  }

  private toRel(absPath: string): string | undefined {
    if (!this.workspaceFolder) return undefined;
    const root = this.workspaceFolder.uri.fsPath;
    let rel = path.relative(root, absPath);
    if (rel.startsWith('..')) return undefined;
    // normalize to posix style for consistency
    rel = rel.split(path.sep).join(path.posix.sep);
    return rel;
  }

  private shouldExclude(rel: string): boolean {
    // very light exclusion logic for MVP
    if (rel.includes('/.git/') || rel.includes('/.nogit/') || rel.includes('/node_modules/') || rel.includes('/dist/') || rel.includes('/out/')) {
      return true;
    }
    return false;
  }

  private makeTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return ts;
  }
}
