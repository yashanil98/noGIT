import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { matchesAny } from './glob';
import { uniqueSnapshotName } from './snapshotName';

export interface SnapshotInfo {
  timestamp: string;            // YYYYMMDD-HHmmss
  files: string[];              // relative paths
  label?: string;               // set for named checkpoints
}

const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/.nogit/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
];

export class SnapshotManager {
  private context: vscode.ExtensionContext;
  private timer: NodeJS.Timeout | undefined;
  private modified: Set<string> = new Set(); // relative paths within workspace
  private workspaceFolder: vscode.WorkspaceFolder | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!this.workspaceFolder) {
      vscode.window.showWarningMessage('noGIT: Open a folder/workspace to enable snapshots.');
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

    // Watch the filesystem directly so changes made outside the editor are
    // captured too. AI coding agents and other tools often write files
    // through the filesystem rather than through an editor document, which
    // the onDidChange/onDidSave document events never see. The exclude check
    // skips our own .nogit/ writes, so this does not feed back on itself.
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const track = (uri: vscode.Uri) => {
      if (uri.scheme !== 'file') return;
      const rel = this.toRel(uri.fsPath);
      if (!rel) return;
      if (this.shouldExclude(rel)) return;
      this.modified.add(rel);
    };
    this.watcher.onDidCreate(track, null, this.context.subscriptions);
    this.watcher.onDidChange(track, null, this.context.subscriptions);
    this.context.subscriptions.push(this.watcher);
  }

  public start() {
    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    if (!enabled || !this.workspaceFolder) return;
    this.restartTimer();
  }

  public dispose() {
    if (this.timer) clearInterval(this.timer);
    this.watcher?.dispose();
  }

  public async snapshotNow() {
    if (!this.workspaceFolder) return;
    const items = Array.from(this.modified);
    this.modified.clear();

    if (items.length === 0) return; // nothing changed

    const copied = await this.writeSnapshot(items);
    await this.pruneOldSnapshots();
    vscode.window.setStatusBarMessage(`noGIT snapshot saved (${copied} files)`, 3000);
  }

  // Capture a named checkpoint of the entire current workspace, so a restore
  // brings everything back to exactly this point. Useful before handing the
  // workspace to an AI agent or any bulk operation. Checkpoints are kept out
  // of automatic pruning.
  public async checkpoint(label: string): Promise<number> {
    if (!this.workspaceFolder) return 0;
    const exclude = `{${this.activeExcludeGlobs().join(',')}}`;
    const uris = await vscode.workspace.findFiles('**/*', exclude);
    const rels: string[] = [];
    for (const uri of uris) {
      const rel = this.toRel(uri.fsPath);
      if (rel && !this.shouldExclude(rel)) rels.push(rel);
    }
    const copied = await this.writeSnapshot(rels, label);
    vscode.window.setStatusBarMessage(`noGIT checkpoint "${label}" saved (${copied} files)`, 4000);
    return copied;
  }

  // Write the given files into a new timestamped snapshot folder and record a
  // manifest. Returns the number of files actually copied.
  private async writeSnapshot(rels: string[], label?: string): Promise<number> {
    if (!this.workspaceFolder) return 0;
    const snapRoot = await this.getSnapshotsRoot();
    // Pick a folder name that does not collide with an existing snapshot. Two
    // snapshots in the same second would otherwise merge into one folder and
    // overwrite each other's manifest, orphaning files and dropping labels.
    let existing: string[] = [];
    try {
      const entries = await fs.readdir(snapRoot, { withFileTypes: true });
      existing = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      // root was just created or unreadable; treat as empty
    }
    const ts = uniqueSnapshotName(this.makeTimestamp(), existing);
    const snapDir = path.join(snapRoot, ts);
    await fs.mkdir(snapDir, { recursive: true });

    const copied: string[] = [];
    for (const rel of rels) {
      try {
        const abs = path.join(this.workspaceFolder.uri.fsPath, rel);
        const dest = path.join(snapDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const data = await fs.readFile(abs);
        await fs.writeFile(dest, data);
        copied.push(rel);
      } catch (err) {
        console.error('noGIT copy failed for', rel, err);
      }
    }

    const manifest: SnapshotInfo = { timestamp: ts, files: copied };
    if (label) manifest.label = label;
    await fs.writeFile(path.join(snapDir, 'meta.json'), JSON.stringify(manifest, null, 2), 'utf8');
    return copied.length;
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

  // Absolute path to a file in the current workspace, or undefined when no
  // folder is open.
  public resolveWorkspacePath(relPath: string): string | undefined {
    if (!this.workspaceFolder) return undefined;
    return path.join(this.workspaceFolder.uri.fsPath, relPath);
  }

  // Restore a single file from a snapshot back into the workspace. The current
  // contents are captured in a fresh snapshot first so the restore is itself
  // undoable. Returns true on success.
  public async restoreFile(ts: string, rel: string): Promise<boolean> {
    if (!this.workspaceFolder) return false;
    const src = this.resolveSnapshotPath(ts, rel);
    if (!src) return false;
    await this.backupBeforeRestore([rel]);
    const ok = await this.copyInto(src, rel);
    if (!ok) return false;
    vscode.window.setStatusBarMessage(`noGIT restored ${rel}`, 3000);
    return true;
  }

  // Restore every file captured in a snapshot. The current state is captured
  // first. Returns the number of files restored.
  public async restoreSnapshot(ts: string): Promise<number> {
    if (!this.workspaceFolder) return 0;
    const snap = (await this.listSnapshots()).find(s => s.timestamp === ts);
    if (!snap) return 0;
    await this.backupBeforeRestore(snap.files);
    let restored = 0;
    for (const rel of snap.files) {
      const src = this.resolveSnapshotPath(ts, rel);
      if (!src) continue;
      if (await this.copyInto(src, rel)) restored++;
    }
    vscode.window.setStatusBarMessage(`noGIT restored ${restored} file(s) from ${ts}`, 3000);
    return restored;
  }

  // Capture the current on-disk contents of the given files into a snapshot so
  // a restore can itself be undone, even for files that were not in the pending
  // modified set.
  private async backupBeforeRestore(rels: string[]) {
    for (const rel of rels) this.modified.add(rel);
    await this.snapshotNow();
  }

  private async copyInto(src: string, rel: string): Promise<boolean> {
    if (!this.workspaceFolder) return false;
    try {
      const dest = path.join(this.workspaceFolder.uri.fsPath, rel);
      const data = await fs.readFile(src);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, data);
      return true;
    } catch (err) {
      console.error('noGIT restore failed for', rel, err);
      return false;
    }
  }

  private async pruneOldSnapshots() {
    const root = await this.getSnapshotsRoot();
    const max = vscode.workspace.getConfiguration('nogit').get<number>('maxSnapshots', 48);
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();
      // Named checkpoints are intentional restore points; never auto-prune
      // them. Only automatic snapshots count against maxSnapshots.
      const auto: string[] = [];
      for (const d of dirs) {
        if (!(await this.isCheckpoint(root, d))) auto.push(d);
      }
      const excess = Math.max(0, auto.length - max);
      for (let i = 0; i < excess; i++) {
        const dir = path.join(root, auto[i]);
        await fs.rm(dir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  private async isCheckpoint(root: string, dir: string): Promise<boolean> {
    try {
      const meta = JSON.parse(
        await fs.readFile(path.join(root, dir, 'meta.json'), 'utf8')
      ) as SnapshotInfo;
      return typeof meta.label === 'string' && meta.label.length > 0;
    } catch {
      return false;
    }
  }

  private async getSnapshotsRoot(): Promise<string> {
    if (!this.workspaceFolder) throw new Error('No workspace');
    const base = path.join(this.workspaceFolder.uri.fsPath, this.snapshotFolderName());
    const root = path.join(base, 'snapshots');
    await fs.mkdir(root, { recursive: true });
    await this.ensureStoreGitignored(base);
    return root;
  }

  // Drop a .gitignore inside the snapshot folder so the local history never
  // shows up as untracked noise when the workspace is a git repo. The single
  // "*" entry ignores the whole folder (the .gitignore ignores itself too).
  // Written once; never overwrites a file the user may have edited.
  private async ensureStoreGitignored(base: string) {
    const gitignore = path.join(base, '.gitignore');
    try {
      await fs.access(gitignore);
    } catch {
      try {
        await fs.writeFile(gitignore, '*\n', 'utf8');
      } catch (err) {
        console.error('noGIT could not write', gitignore, err);
      }
    }
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

  private activeExcludeGlobs(): string[] {
    return vscode.workspace
      .getConfiguration('nogit')
      .get<string[]>('excludePatterns', DEFAULT_EXCLUDES);
  }

  private shouldExclude(rel: string): boolean {
    // Always skip our own snapshot folder, regardless of user config. The
    // filesystem watcher fires on snapshot writes, so without this guard a
    // custom excludePatterns that drops the .nogit entry would make noGIT
    // snapshot its own snapshots in a loop.
    const folder = this.snapshotFolderName();
    if (rel === folder || rel.startsWith(`${folder}/`)) return true;

    return matchesAny(this.activeExcludeGlobs(), rel);
  }

  private makeTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return ts;
  }
}
