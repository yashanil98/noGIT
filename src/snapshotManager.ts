import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { matchesAny } from './glob';
import { uniqueSnapshotName, isValidSnapshotName } from './snapshotName';
import { relativeTime, formatStamp } from './relativeTime';
import { toWorkspaceRel, isInside } from './paths';
import { parseManifest } from './manifest';
import { selectSnapshotsToPrune, SnapshotEntry } from './prune';
import { canRestoreSafely } from './restoreGate';

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
  private disposed = false;
  // Disposables for the change tracking (document listeners + filesystem
  // watcher). Held separately from context.subscriptions so they can be torn
  // down when the user disables automatic snapshots, then recreated on enable.
  private trackingDisposables: vscode.Disposable[] = [];

  // Fires whenever the set of stored snapshots changes (a snapshot written or
  // deleted). The timeline panel listens so it refreshes without the user
  // clicking Refresh.
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  public readonly onDidChangeSnapshots = this.changeEmitter.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;

    // Listen for config and folder changes regardless of whether a folder is
    // open yet. If the user opens a folder into an empty window after we
    // activated, adoptFolderIfNeeded picks it up instead of staying dead.
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('nogit')) {
        this.restartTimer();
        this.refreshTracking();
        this.restartStatusTimer();
        this.updateStatusItem();
      }
    }, null, this.context.subscriptions);

    vscode.workspace.onDidChangeWorkspaceFolders(() => this.adoptFolderIfNeeded(),
      null, this.context.subscriptions);

    this.workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!this.workspaceFolder) {
      vscode.window.showWarningMessage('noGIT: Open a folder/workspace to enable snapshots.');
      return;
    }
    this.notifyIfMultiRoot();
    this.setupForFolder();
  }

  // Folder-dependent setup, shared by the constructor and the late-open path.
  private setupForFolder() {
    // A quiet status bar presence: shows when the last snapshot was taken and
    // opens the timeline on click. Refreshed after each snapshot and on a slow
    // timer so the relative time stays current.
    this.statusItem = vscode.window.createStatusBarItem('nogit.status', vscode.StatusBarAlignment.Right, 100);
    this.statusItem.name = 'noGIT';
    this.statusItem.command = 'nogit.showTimeline';
    this.context.subscriptions.push(this.statusItem);
    this.updateStatusItem(); // shows or hides the item per the setting
    this.refreshTracking();
  }

  // When a folder is opened into a window that started empty, begin operating
  // on it. No-op once a folder has already been adopted.
  private adoptFolderIfNeeded() {
    if (this.workspaceFolder) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;
    this.workspaceFolder = folder;
    this.notifyIfMultiRoot();
    this.setupForFolder();
    this.start();
  }

  // noGIT snapshots only the first workspace folder. Tell multi-root users so
  // the limitation is visible rather than silent. Per-root capture is a
  // separate, larger feature.
  private notifyIfMultiRoot() {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length > 1) {
      vscode.window.showInformationMessage(
        `noGIT: this is a multi-root workspace. Only the first folder (${this.workspaceFolder?.name}) is being snapshotted.`
      );
    }
  }

  // Install or remove the change-tracking listeners and filesystem watcher to
  // match the nogit.enable setting. There is no reason to watch the whole
  // workspace when automatic snapshots are off.
  private refreshTracking() {
    if (!this.workspaceFolder) return;
    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    const active = this.trackingDisposables.length > 0;
    if (enabled && !active) {
      this.installTracking();
    } else if (!enabled && active) {
      this.teardownTracking();
    }
  }

  private installTracking() {
    const track = (uri: vscode.Uri) => {
      if (uri.scheme !== 'file') return;
      const rel = this.toRel(uri.fsPath);
      if (!rel) return;
      if (this.shouldExclude(rel)) return;
      this.modified.add(rel);
    };

    this.trackingDisposables.push(
      vscode.workspace.onDidChangeTextDocument(e => track(e.document.uri)),
      vscode.workspace.onDidSaveTextDocument(doc => track(doc.uri)),
    );

    // Watch the filesystem directly so changes made outside the editor are
    // captured too. AI coding agents and other tools often write files
    // through the filesystem rather than through an editor document, which
    // the document events never see. The exclude check skips our own .nogit/
    // writes, so this does not feed back on itself.
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.watcher.onDidCreate(track);
    this.watcher.onDidChange(track);
    this.trackingDisposables.push(this.watcher);
  }

  private teardownTracking() {
    for (const d of this.trackingDisposables) d.dispose();
    this.trackingDisposables = [];
    this.watcher = undefined;
    this.modified.clear();
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
    this.restartStatusTimer();

    const enabled = vscode.workspace.getConfiguration('nogit').get<boolean>('enable', true);
    if (!enabled) return;
    this.restartTimer();
  }

  public dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.teardownTracking();
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
    const { files: copied } = await this.writeSnapshot(items);
    for (const rel of copied) this.modified.delete(rel);
    if (copied.length === 0) return; // nothing readable was captured
    await this.pruneOldSnapshots();
    vscode.window.setStatusBarMessage(`noGIT snapshot saved (${copied.length} files)`, 3000);
  }

  // Capture a named checkpoint of the entire current workspace. Restoring it
  // re-creates the captured files with their checkpoint contents; it does not
  // delete files added afterward. Useful before handing the workspace to an AI
  // agent or any bulk operation. Checkpoints are kept out of automatic pruning.
  public async checkpoint(label: string): Promise<number> {
    if (!this.workspaceFolder) return 0;
    // A checkpoint is identified by a non-empty label, and that label is what
    // protects it from pruning. Reject an empty or whitespace-only label so a
    // caller cannot create a snapshot they think is a permanent checkpoint
    // that pruning would then treat as an ordinary auto-snapshot.
    const trimmed = label.trim();
    if (!trimmed) return 0;
    // shouldExclude below is the single source of truth for exclusions, using
    // the same matcher as auto-snapshots. Pass findFiles only a hint to skip
    // our own snapshot store (which can be large) rather than a brace glob
    // built from the user patterns, whose separate glob engine mishandles
    // single-pattern, empty, and comma-containing cases.
    const exclude = `**/${this.snapshotFolderName()}/**`;
    const uris = await vscode.workspace.findFiles('**/*', exclude);
    const rels: string[] = [];
    for (const uri of uris) {
      const rel = this.toRel(uri.fsPath);
      if (rel && !this.shouldExclude(rel)) rels.push(rel);
    }
    const copied = (await this.writeSnapshot(rels, trimmed)).files.length;
    vscode.window.setStatusBarMessage(`noGIT checkpoint "${trimmed}" saved (${copied} files)`, 4000);
    return copied;
  }

  // Write the given files into a new timestamped snapshot folder and record a
  // manifest. Returns the snapshot timestamp (undefined when nothing could be
  // captured and no folder was kept) and the relative paths actually copied.
  private async writeSnapshot(rels: string[], label?: string): Promise<{ ts: string | undefined; files: string[] }> {
    if (!this.workspaceFolder) return { ts: undefined, files: [] };
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

    const maxBytes = vscode.workspace.getConfiguration('nogit').get<number>('maxFileSizeBytes', 5000000);
    const copied: string[] = [];
    for (const rel of rels) {
      try {
        const abs = path.join(this.workspaceFolder.uri.fsPath, rel);
        // lstat does not follow symlinks, so a symlink is reported as a link
        // rather than its target. Skip anything that is not a regular file so
        // a symlink can never copy data from outside the workspace into the
        // store, and skip files over the configured size cap (0 = no limit).
        const st = await fs.lstat(abs);
        if (!st.isFile()) continue;
        if (maxBytes > 0 && st.size > maxBytes) continue;
        const dest = path.join(snapDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
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
      return { ts: undefined, files: [] };
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
    return { ts, files: copied };
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
    // Read the manifests concurrently. listSnapshots runs on the panel's
    // auto-refresh path (every snapshot, restore, and delete), so reading each
    // meta.json in sequence made latency scale with the snapshot count. dirs is
    // already newest-first, so the mapped results preserve that order.
    const metas = await Promise.all(dirs.map(async d => {
      try {
        return parseManifest(await fs.readFile(path.join(root, d, 'meta.json'), 'utf8'));
      } catch {
        return undefined; // ignore unreadable snapshot
      }
    }));
    return metas.filter((m): m is SnapshotInfo => m !== undefined);
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
  // undoable. If that backup could not capture the current file, the restore is
  // skipped rather than destroying a version that cannot be recovered. Returns
  // true on success.
  public async restoreFile(ts: string, rel: string): Promise<boolean> {
    if (!this.workspaceFolder) return false;
    const src = this.resolveSnapshotPath(ts, rel);
    if (!src) return false;
    const backup = await this.backupBeforeRestore([rel]);
    if (!(await this.canOverwrite(rel, backup.files))) {
      vscode.window.showWarningMessage(
        `noGIT: could not back up ${rel} before restoring, so the restore was skipped to avoid losing your current version.`
      );
      return false;
    }
    const ok = await this.copyInto(src, rel);
    if (!ok) return false;
    this.offerUndo(`noGIT restored ${rel}.`, backup.ts);
    return true;
  }

  // Restore every file captured in a snapshot. The current state is captured
  // first, and any file the backup could not save is skipped rather than
  // overwritten. Returns the number of files restored.
  public async restoreSnapshot(ts: string): Promise<number> {
    if (!this.workspaceFolder) return 0;
    // Read just this snapshot's manifest rather than scanning every snapshot to
    // find one known timestamp. resolveSnapshotPath validates ts, so a bad
    // value yields no path and we bail.
    const metaPath = this.resolveSnapshotPath(ts, 'meta.json');
    if (!metaPath) return 0;
    let snap: SnapshotInfo | undefined;
    try {
      snap = parseManifest(await fs.readFile(metaPath, 'utf8'));
    } catch {
      snap = undefined;
    }
    if (!snap) return 0;
    const backup = await this.backupBeforeRestore(snap.files);
    let restored = 0;
    const skipped: string[] = [];
    for (const rel of snap.files) {
      const src = this.resolveSnapshotPath(ts, rel);
      if (!src) continue;
      if (!(await this.canOverwrite(rel, backup.files))) {
        skipped.push(rel);
        continue;
      }
      if (await this.copyInto(src, rel)) restored++;
    }
    if (skipped.length > 0) {
      vscode.window.showWarningMessage(
        `noGIT restored ${restored} file(s) from ${ts}. Skipped ${skipped.length} that could not be backed up first: ${skipped.join(', ')}.`
      );
    } else {
      this.offerUndo(`noGIT restored ${restored} file(s) from ${formatStamp(ts)}.`, backup.ts);
    }
    return restored;
  }

  // Whether restoring `rel` is safe: either it does not currently exist (so
  // there is nothing to lose) or its current contents were captured in the
  // pre-restore backup.
  private async canOverwrite(rel: string, backedUp: Set<string>): Promise<boolean> {
    const abs = this.resolveWorkspacePath(rel);
    let exists = false;
    if (abs) {
      try {
        await fs.access(abs);
        exists = true;
      } catch {
        exists = false;
      }
    }
    return canRestoreSafely(exists, backedUp.has(rel));
  }

  // Tell the user a restore succeeded and, when a pre-restore backup was taken,
  // offer one click to undo by restoring from that backup. Without a backup
  // (nothing needed capturing) there is nothing to undo, so just report.
  private offerUndo(message: string, backupTs: string | undefined) {
    if (!backupTs) {
      vscode.window.setStatusBarMessage(message, 3000);
      return;
    }
    void vscode.window
      .showInformationMessage(`${message} Your previous version was snapshotted.`, 'Undo')
      .then(pick => {
        if (pick === 'Undo') void this.restoreSnapshot(backupTs);
      });
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
  // modified set. Returns the backup's timestamp (undefined if nothing was
  // captured) and the set of files actually captured, so the caller can refuse
  // to overwrite anything the backup could not save and can offer an undo.
  private async backupBeforeRestore(rels: string[]): Promise<{ ts: string | undefined; files: Set<string> }> {
    const { ts, files } = await this.writeSnapshot(rels);
    return { ts, files: new Set(files) };
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
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
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

  // Run the once-a-minute status refresh only while the status item is shown.
  // The relative time it displays does not need updating when the item is
  // hidden, so a disabled item should not cause periodic wakeups.
  private restartStatusTimer() {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = undefined;
    if (!this.workspaceFolder) return;
    const show = vscode.workspace.getConfiguration('nogit').get<boolean>('showStatusBarItem', true);
    if (!show) return;
    this.statusTimer = setInterval(() => this.updateStatusItem(), 60 * 1000);
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
