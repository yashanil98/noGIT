import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { matchesAny } from './glob';
import { uniqueSnapshotName, isValidSnapshotName } from './snapshotName';
import { relativeTime } from './relativeTime';
import { toWorkspaceRel, isInside } from './paths';
import { parseManifest } from './manifest';
import { selectSnapshotsToPrune, SnapshotEntry } from './prune';

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
  private statusItem: vscode.StatusBarItem | undefined;
  private statusTimer: NodeJS.Timeout | undefined;
  private lastSnapshotTs: string | undefined;

  // Fires whenever the set of stored snapshots changes (a snapshot written or
  // deleted). The timeline panel listens so it refreshes without the user
  // clicking Refresh.
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeSnapshots = this.changeEmitter.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!this.workspaceFolder) {
      vscode.window.showWarningMessage('noGIT: Open a folder/workspace to enable snapshots.');
      return;
    }

    // A quiet status bar presence: shows when the last snapshot was taken and
    // opens the timeline on click. Refreshed after each snapshot and on a slow
    // timer so the relative time stays current.
    this.statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusItem.command = 'nogit.showTimeline';
    this.context.subscriptions.push(this.statusItem);
    this.updateStatusItem(); // shows or hides the item per the setting

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
        this.updateStatusItem();
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
    if (!this.workspaceFolder) return;
    // Seed the status item from the most recent snapshot on disk so it shows a
    // real time across restarts, not "No snapshots yet".
    void this.listSnapshots().then(snaps => {
      if (snaps.length > 0 && !this.lastSnapshotTs) {
        this.lastSnapshotTs = snaps[0].timestamp;
        this.updateStatusItem();
      }
    });
    // Keep the relative time fresh without taking snapshots.
    this.statusTimer = setInterval(() => this.updateStatusItem(), 60 * 1000);

    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    if (!enabled) return;
    this.restartTimer();
  }

  public dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.watcher?.dispose();
    this.statusItem?.dispose();
    this.changeEmitter.dispose();
  }

  // Refresh the status bar label from the last snapshot time, or hide the item
  // when the user has turned it off. Safe to call when no folder is open (the
  // item is never created in that case).
  private updateStatusItem() {
    if (!this.statusItem) return;
    const show = vscode.workspace.getConfiguration('nogit').get<boolean>('showStatusBarItem', true);
    if (!show) {
      this.statusItem.hide();
      return;
    }
    const when = this.lastSnapshotTs
      ? relativeTime(this.lastSnapshotTs, Date.now())
      : undefined;
    this.statusItem.text = when ? `$(history) noGIT: ${when}` : '$(history) noGIT';
    this.statusItem.tooltip = when
      ? `Last snapshot ${when}. Click to open the timeline.`
      : 'noGIT: no snapshots yet. Click to open the timeline.';
    this.statusItem.show();
  }

  // Snapshot the files modified since the last snapshot. When `explicit` is
  // set (the user ran the command directly), surface a message if there was
  // nothing to capture, so a manual trigger never appears to do nothing. The
  // timer and the public API leave it false and stay silent.
  public async snapshotNow(explicit = false) {
    if (!this.workspaceFolder) {
      if (explicit) vscode.window.showWarningMessage('noGIT: Open a folder to take snapshots.');
      return;
    }
    const items = Array.from(this.modified);

    if (items.length === 0) {
      if (explicit) {
        vscode.window.setStatusBarMessage('noGIT: no changes since the last snapshot', 3000);
      }
      return;
    }

    // Clear only the files actually captured, not the whole set up front. If a
    // write fails (or the manager is disposed mid-await), the uncaptured files
    // stay marked and get another chance on the next snapshot rather than being
    // silently dropped from tracking. Edits arriving during the await are also
    // preserved this way.
    const copied = await this.writeSnapshot(items);
    for (const rel of copied) this.modified.delete(rel);
    if (copied.length === 0) return; // nothing readable was captured
    await this.pruneOldSnapshots();
    vscode.window.setStatusBarMessage(`noGIT snapshot saved (${copied.length} files)`, 3000);
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
    const copied = (await this.writeSnapshot(rels, label)).length;
    vscode.window.setStatusBarMessage(`noGIT checkpoint "${label}" saved (${copied} files)`, 4000);
    return copied;
  }

  // Write the given files into a new timestamped snapshot folder and record a
  // manifest. Returns the relative paths actually copied (empty when nothing
  // could be captured).
  private async writeSnapshot(rels: string[], label?: string): Promise<string[]> {
    if (!this.workspaceFolder) return [];
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

    // If nothing could be copied (for example every candidate file was deleted
    // between being marked and being read), do not leave an empty snapshot
    // folder and manifest behind.
    if (copied.length === 0) {
      await fs.rm(snapDir, { recursive: true, force: true });
      return [];
    }

    const manifest: SnapshotInfo = { timestamp: ts, files: copied };
    if (label) manifest.label = label;
    // Write the manifest atomically: a partial meta.json (interrupted write)
    // would otherwise be read as a malformed snapshot and, for a checkpoint,
    // could be misclassified. Write to a temp file then rename into place.
    const metaPath = path.join(snapDir, 'meta.json');
    const tmpPath = path.join(snapDir, 'meta.json.tmp');
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(tmpPath, metaPath);

    this.lastSnapshotTs = ts;
    this.updateStatusItem();
    this.changeEmitter.fire();
    return copied;
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
        const meta = parseManifest(await fs.readFile(path.join(root, d, 'meta.json'), 'utf8'));
        if (meta) results.push(meta); // skip a malformed or partial manifest
      } catch {
        // ignore unreadable snapshot
      }
    }
    return results;
  }

  public resolveSnapshotPath(ts: string, relPath: string): string | undefined {
    if (!this.workspaceFolder) return undefined;
    // Both arguments can originate from a manifest on disk (which an agent or
    // user could edit) or from a headless API call, so neither is trusted. The
    // timestamp must be a well-formed folder name, and the joined path must not
    // escape the snapshot directory via "..".
    if (!isValidSnapshotName(ts)) return undefined;
    const snapDir = path.join(this.workspaceFolder.uri.fsPath, this.snapshotFolderName(), 'snapshots', ts);
    const full = path.join(snapDir, relPath);
    if (!isInside(snapDir, full)) return undefined;
    return full;
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

  // Delete a snapshot or checkpoint folder from the store. The timestamp is
  // validated first so a caller-supplied value can never point outside the
  // snapshots folder. Returns true if a folder was removed.
  public async deleteSnapshot(ts: string): Promise<boolean> {
    if (!this.workspaceFolder) return false;
    if (!isValidSnapshotName(ts)) return false;
    const root = await this.getSnapshotsRoot();
    const dir = path.join(root, ts);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (err) {
      console.error('noGIT delete failed for', ts, err);
      return false;
    }
    if (this.lastSnapshotTs === ts) {
      const remaining = await this.listSnapshots();
      this.lastSnapshotTs = remaining[0]?.timestamp;
      this.updateStatusItem();
    }
    this.changeEmitter.fire();
    return true;
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
    const root = this.workspaceFolder.uri.fsPath;
    const dest = path.join(root, rel);
    // A restore writes back into the workspace. Refuse any destination that
    // resolves outside the root, so a crafted relative path (for example from
    // an edited manifest or a headless API call) can never overwrite files
    // elsewhere on disk.
    if (!isInside(root, dest)) {
      console.error('noGIT refused out-of-workspace restore for', rel);
      return false;
    }
    try {
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
      const dirEntries = await fs.readdir(root, { withFileTypes: true });
      const dirs = dirEntries.filter(e => e.isDirectory()).map(e => e.name);
      const entries: SnapshotEntry[] = [];
      for (const d of dirs) {
        entries.push({ name: d, isCheckpoint: await this.isCheckpoint(root, d) });
      }
      for (const name of selectSnapshotsToPrune(entries, max)) {
        await fs.rm(path.join(root, name), { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  private async isCheckpoint(root: string, dir: string): Promise<boolean> {
    try {
      const meta = parseManifest(await fs.readFile(path.join(root, dir, 'meta.json'), 'utf8'));
      if (!meta) return true; // unparseable manifest: treat as protected, never auto-prune
      return typeof meta.label === 'string' && meta.label.length > 0;
    } catch {
      // A manifest we cannot read (missing, mid-write, permission error) is
      // treated as a protected checkpoint so pruning never deletes data it
      // could not classify.
      return true;
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
    return toWorkspaceRel(this.workspaceFolder.uri.fsPath, absPath);
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
