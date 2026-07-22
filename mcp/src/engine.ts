import * as fs from 'node:fs/promises';
import * as fsWatch from 'node:fs';
import * as path from 'node:path';

// Pure modules reused from the extension, inlined here to avoid cross-package
// imports that would complicate the build. Each function is small and
// well-specified; keeping a local copy means the mcp package has zero coupling
// to the extension's build output while staying format-compatible.

// --- glob.ts (verbatim logic) ---
const regexCache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
  let regexBody = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**/', i)) {
      regexBody += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      regexBody += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      regexBody += '[^/]*';
      i += 1;
    } else {
      regexBody += pattern[i].replace(/[.+^${}()|[\]\\?]/, '\\$&');
      i += 1;
    }
  }
  const regex = new RegExp(`^${regexBody}$`);
  regexCache.set(pattern, regex);
  return regex;
}

function matchesAny(patterns: string[], relPath: string): boolean {
  return patterns.some(p => compile(p).test(relPath));
}

// --- paths.ts (verbatim logic) ---
function toWorkspaceRel(root: string, absPath: string): string | undefined {
  const rel = path.relative(root, absPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join(path.posix.sep);
}

function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isWithinSnapshotFolder(rel: string, folderName: string): boolean {
  return rel === folderName || rel.startsWith(`${folderName}/`);
}

// --- realpath.ts (verbatim logic) ---
async function isRealPathInside(root: string, target: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return false;
  }
  let current = path.resolve(target);
  const tail: string[] = [];
  for (let guard = 0; guard < 4096; guard++) {
    try {
      const real = await fs.realpath(current);
      const full = tail.length ? path.join(real, ...tail) : real;
      return isInside(realRoot, full);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
  return false;
}

// --- snapshotName.ts (verbatim logic) ---
function uniqueSnapshotName(base: string, taken: Iterable<string>): string {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!set.has(candidate)) return candidate;
  }
}

function isValidSnapshotName(name: string): boolean {
  return /^\d{8}-\d{6}(?:-\d+)?$/.test(name);
}

// --- snapshotOrder.ts (verbatim logic) ---
function compareSnapshotNames(a: string, b: string): number {
  const [baseA, suffixA] = splitSnapshotName(a);
  const [baseB, suffixB] = splitSnapshotName(b);
  if (baseA < baseB) return -1;
  if (baseA > baseB) return 1;
  return suffixA - suffixB;
}

function splitSnapshotName(name: string): [string, number] {
  const m = /^(\d{8}-\d{6})-(\d+)$/.exec(name);
  if (m) return [m[1], Number(m[2])];
  return [name, 0];
}

// --- relativeTime.ts (formatTimestamp only) ---
function formatTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// --- manifest.ts (verbatim logic) ---
export interface SnapshotInfo {
  timestamp: string;
  files: string[];
  label?: string;
  auto?: boolean;
}

function parseManifest(raw: string): SnapshotInfo | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.timestamp !== 'string') return undefined;
  if (!/^\d{8}-\d{6}(?:-\d+)?$/.test(obj.timestamp)) return undefined;
  if (!Array.isArray(obj.files) || !obj.files.every(f => typeof f === 'string')) return undefined;
  if (obj.label !== undefined && typeof obj.label !== 'string') return undefined;
  if (obj.auto !== undefined && typeof obj.auto !== 'boolean') return undefined;
  // Deduplicate so every consumer sees a consistent unique file list. Do NOT
  // rewrite backslashes: the extension and this engine both convert path.sep to
  // a posix '/' via toWorkspaceRel before writing, so a '\' in a stored path is
  // a literal filename character (legal on macOS/Linux), not a separator.
  // Rewriting it would break the manifest path's link to the file on disk --
  // diffSummary would report a phantom add+delete and restoreSnapshot would
  // fail to recover the file. This matches the extension's parseManifest, which
  // stores obj.files verbatim.
  const files = [...new Set(obj.files as string[])];
  const result: SnapshotInfo = { timestamp: obj.timestamp, files };
  if (typeof obj.label === 'string') result.label = obj.label;
  if (obj.auto === true) result.auto = true;
  return result;
}

// --- prune.ts (verbatim logic) ---
interface SnapshotEntry {
  name: string;
  isCheckpoint: boolean;
}

function isProtectedCheckpoint(meta: { label?: string; auto?: boolean }): boolean {
  return typeof meta.label === 'string' && meta.label.length > 0 && meta.auto !== true;
}

function selectSnapshotsToPrune(entries: SnapshotEntry[], max: number): string[] {
  const auto = entries
    .filter(e => !e.isCheckpoint)
    .map(e => e.name)
    .sort(compareSnapshotNames);
  const excess = Math.max(0, auto.length - Math.max(0, max));
  return auto.slice(0, excess);
}

// --- concurrency.ts (verbatim logic) ---
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  let next = 0;
  async function runner(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from(
    { length: Math.min(effectiveLimit, items.length) },
    () => runner(),
  );
  await Promise.all(runners);
  return results;
}

// --- latestCheckpoint.ts (adapted for MCP) ---
// Returns the most recent manual checkpoint (has a label and is NOT auto).
// Auto-burst snapshots created by the VS Code extension have labels like
// "auto: 14 files changed" but are not meaningful save points for agents.
function findLatestCheckpoint(snapshots: SnapshotInfo[]): SnapshotInfo | undefined {
  let best: SnapshotInfo | undefined;
  for (const s of snapshots) {
    if (!isProtectedCheckpoint(s)) continue;
    if (best === undefined || compareSnapshotNames(s.timestamp, best.timestamp) > 0) best = s;
  }
  return best;
}

// --- emptyDirs.ts (verbatim logic) ---
function emptyDirCandidates(deletedRels: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of deletedRels) {
    let dir = parentPosix(rel);
    while (dir !== '') {
      dirs.add(dir);
      dir = parentPosix(dir);
    }
  }
  return [...dirs].sort((a, b) => {
    const depth = segmentCount(b) - segmentCount(a);
    return depth !== 0 ? depth : (a < b ? -1 : a > b ? 1 : 0);
  });
}

function parentPosix(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function segmentCount(p: string): number {
  return p.length === 0 ? 0 : p.split('/').length;
}

// --- exactRestore.ts (verbatim logic) ---
function filesToDeleteForExactRestore(
  currentFiles: readonly string[],
  checkpointFiles: readonly string[],
): string[] {
  const kept = new Set(checkpointFiles);
  return currentFiles.filter(rel => !kept.has(rel));
}

// --- restoreGate.ts (verbatim logic) ---
function canRestoreSafely(fileExists: boolean, wasBackedUp: boolean): boolean {
  return !fileExists || wasBackedUp;
}

// --- serialQueue.ts (verbatim logic) ---
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

// ============================================================================
// SnapshotEngine: the vscode-free implementation of snapshot/list/restore
// ============================================================================

const DEFAULT_EXCLUDES = [
  '**/.git',
  '**/.git/**',
  '**/.nogit',
  '**/.nogit/**',
  '**/node_modules',
  '**/node_modules/**',
  '**/dist',
  '**/dist/**',
  '**/out',
  '**/out/**',
];

const COPY_CONCURRENCY = 16;

// Cap on checkpoint label length. Labels are stored in every manifest and
// searched on each listSnapshots / resolveTimestamp call, so an unbounded
// label would bloat the store and slow every operation. 1000 chars is far
// beyond any reasonable label.
const MAX_LABEL_LENGTH = 1000;

// Grace period before a manifest-less snapshot directory is treated as a
// crashed-write orphan and removed during pruning. Genuine writes complete
// in milliseconds; 60s is far longer than any real write yet bounds how long
// orphans linger. Guards against deleting a directory whose manifest write is
// still in flight from a concurrent operation.
const ORPHAN_GRACE_MS = 60_000;

export interface EngineOptions {
  root: string;
  snapshotFolderName?: string;
  excludePatterns?: string[];
  maxFileSizeBytes?: number;
  maxSnapshots?: number;
}

export class SnapshotEngine {
  private readonly root: string;
  private readonly folderName: string;
  private readonly excludes: string[];
  private readonly maxBytes: number;
  private readonly maxSnapshots: number;
  private readonly writeQueue = new SerialQueue();
  // Serializes whole mutating operations (checkpoint / snapshot / restore /
  // undo). Without this, two operations' workspace file copies can overlap --
  // one operation's copyInto writes workspace/f while another's backup reads
  // workspace/f as a copyFile source, which stalls indefinitely on macOS
  // (concurrent read+write of the same file via clonefile). Serializing makes
  // each operation atomic with respect to the others.
  private readonly opQueue = new SerialQueue();
  private lastIssuedBase = '';
  private lastIssuedSuffix = 0;
  private lastBackupTs: string | undefined;

  constructor(opts: EngineOptions) {
    this.root = path.resolve(opts.root);
    this.folderName = opts.snapshotFolderName ?? '.nogit';
    // User patterns are additive: nobody excluding *.log intends to start
    // snapshotting node_modules and .git.
    this.excludes = [...DEFAULT_EXCLUDES, ...(opts.excludePatterns ?? [])];
    const rawMax = opts.maxFileSizeBytes;
    this.maxBytes = (typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax > 0) ? rawMax : 5_000_000;
    const rawSnaps = opts.maxSnapshots;
    this.maxSnapshots = (typeof rawSnaps === 'number' && Number.isFinite(rawSnaps) && rawSnaps >= 0) ? rawSnaps : 48;
  }

  // Monotonic snapshot name: never issues a name that sorts at or before a
  // name already issued in this engine's lifetime, even if pruning has since
  // deleted the directory or the wall clock jumps backwards (NTP, DST). This
  // keeps names strictly increasing so newest snapshots never sort as oldest
  // and get re-pruned.
  private nextSnapshotName(base: string, existing: string[]): string {
    const ts = uniqueSnapshotName(base, existing);
    const [tsBase, tsSuffix] = splitSnapshotName(ts);
    // If the candidate base is older than the last issued base, or the same
    // base with a non-increasing suffix, bump the suffix on the last base so
    // the name stays strictly increasing. Skip any suffix already on disk.
    if (tsBase < this.lastIssuedBase ||
        (tsBase === this.lastIssuedBase && tsSuffix <= this.lastIssuedSuffix)) {
      const taken = new Set(existing);
      let next = this.lastIssuedSuffix + 1;
      while (taken.has(`${this.lastIssuedBase}-${next}`)) next++;
      this.lastIssuedSuffix = next;
      return `${this.lastIssuedBase}-${next}`;
    }
    this.lastIssuedBase = tsBase;
    this.lastIssuedSuffix = tsSuffix;
    return ts;
  }

  // Recursive directory walk respecting excludes. Returns workspace-relative
  // posix paths for all regular files (no symlinks, no directories).
  private async listWorkspaceFiles(): Promise<string[]> {
    const results: string[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = toWorkspaceRel(this.root, abs);
        if (!rel) continue;
        if (this.shouldExclude(rel)) continue;
        if (entry.isDirectory()) {
          await walk(abs);
        } else if (entry.isFile()) {
          results.push(rel);
        }
      }
    };
    await walk(this.root);
    return results;
  }

  private shouldExclude(rel: string): boolean {
    if (isWithinSnapshotFolder(rel, this.folderName)) return true;
    // A root-level file named like the snapshot manifest maps to the same path
    // as the manifest inside each snapshot directory (snapDir/meta.json). If it
    // were captured, the manifest write would overwrite the copied file, and a
    // later restore would then write the manifest JSON back over the user's own
    // file -- silent data loss. Reserve these names at the workspace root only;
    // nested files like sub/meta.json land at snapDir/sub/meta.json and are safe.
    if (rel === 'meta.json' || rel === 'meta.json.tmp') return true;
    return matchesAny(this.excludes, rel);
  }

  private snapshotsRootPath(): string {
    return path.join(this.root, this.folderName, 'snapshots');
  }

  private async ensureSnapshotsRoot(): Promise<string> {
    const base = path.join(this.root, this.folderName);
    const root = path.join(base, 'snapshots');
    await fs.mkdir(root, { recursive: true });
    await this.ensureStoreGitignored(base);
    return root;
  }

  private async ensureStoreGitignored(base: string) {
    const gitignore = path.join(base, '.gitignore');
    try {
      await fs.access(gitignore);
    } catch {
      try {
        await fs.writeFile(gitignore, '*\n', 'utf8');
      } catch {
        // ignore
      }
    }
  }

  private writeSnapshot(rels: string[], label?: string, auto = false): Promise<{ ts: string | undefined; files: string[] }> {
    return this.writeQueue.run(() => this.writeSnapshotImpl(rels, label, auto));
  }

  // Atomically claim a unique snapshot directory. Uses non-recursive mkdir
  // which fails with EEXIST if another process races us. Retries with a fresh
  // name scan up to 5 times.
  private async claimSnapshotDir(snapRoot: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      let existing: string[] = [];
      try {
        const entries = await fs.readdir(snapRoot, { withFileTypes: true });
        existing = entries.filter(e => e.isDirectory()).map(e => e.name);
      } catch {
        // treat as empty
      }
      const ts = this.nextSnapshotName(formatTimestamp(new Date()), existing);
      try {
        await fs.mkdir(path.join(snapRoot, ts));
        return ts;
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
        // Other errors (permissions etc): create with recursive as fallback
        await fs.mkdir(path.join(snapRoot, ts), { recursive: true });
        return ts;
      }
    }
    // Fallback: use recursive mkdir (should never reach here in practice)
    const existing = await fs.readdir(snapRoot, { withFileTypes: true })
      .then(e => e.filter(x => x.isDirectory()).map(x => x.name))
      .catch(() => [] as string[]);
    const ts = this.nextSnapshotName(formatTimestamp(new Date()), existing);
    await fs.mkdir(path.join(snapRoot, ts), { recursive: true });
    return ts;
  }

  private async writeSnapshotImpl(rels: string[], label?: string, auto = false): Promise<{ ts: string | undefined; files: string[] }> {
    const snapRoot = await this.ensureSnapshotsRoot();
    const ts = await this.claimSnapshotDir(snapRoot);
    const snapDir = path.join(snapRoot, ts);

    const outcomes = await mapWithConcurrency(rels, COPY_CONCURRENCY, async rel => {
      try {
        const abs = path.join(this.root, rel);
        const st = await fs.lstat(abs);
        if (!st.isFile()) return undefined;
        if (this.maxBytes > 0 && st.size > this.maxBytes) return undefined;
        const dest = path.join(snapDir, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(abs, dest);
        return rel;
      } catch {
        return undefined;
      }
    });
    const copied = outcomes.filter((r): r is string => r !== undefined);

    if (copied.length === 0) {
      await fs.rm(snapDir, { recursive: true, force: true });
      return { ts: undefined, files: [] };
    }

    const manifest: SnapshotInfo = { timestamp: ts, files: copied };
    if (label) manifest.label = label;
    if (auto) manifest.auto = true;
    const metaPath = path.join(snapDir, 'meta.json');
    const tmpPath = path.join(snapDir, 'meta.json.tmp');
    // Writing the manifest can fail if the snapshot directory disappears between
    // the copy and this write -- e.g. an external process (another tool, a
    // cleanup script, git clean, the user) removed the .nogit store, since it is
    // a plain gitignored folder. Treat that like the "nothing captured" case:
    // clean up any remnant and report no snapshot, rather than throwing a raw
    // ENOENT that surfaces as an opaque "Internal error" to the caller.
    try {
      await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
      await fs.rename(tmpPath, metaPath);
    } catch {
      await fs.rm(snapDir, { recursive: true, force: true }).catch(() => {});
      return { ts: undefined, files: [] };
    }

    return { ts, files: copied };
  }

  checkpoint(label: string): Promise<{ ts: string | undefined; fileCount: number; totalFiles: number }> {
    return this.opQueue.run(() => this.checkpointImpl(label));
  }

  private async checkpointImpl(label: string): Promise<{ ts: string | undefined; fileCount: number; totalFiles: number }> {
    let trimmed = typeof label === 'string' ? label.trim() : '';
    if (!trimmed) return { ts: undefined, fileCount: 0, totalFiles: 0 };
    // Cap the label so an accidentally huge value (e.g. pasted file contents)
    // cannot permanently bloat every manifest and slow listSnapshots /
    // resolveTimestamp, which read and search labels on every call. Truncate
    // without splitting a surrogate pair, which would leave a lone surrogate
    // that corrupts the label on disk and can break JSON serialization.
    if (trimmed.length > MAX_LABEL_LENGTH) {
      trimmed = trimmed.slice(0, MAX_LABEL_LENGTH);
      const last = trimmed.charCodeAt(trimmed.length - 1);
      if (last >= 0xD800 && last <= 0xDBFF) trimmed = trimmed.slice(0, -1);
    }
    const rels = await this.listWorkspaceFiles();
    const { ts, files } = await this.writeSnapshot(rels, trimmed);
    await this.pruneOldSnapshots();
    return { ts, fileCount: files.length, totalFiles: rels.length };
  }

  snapshotNow(): Promise<{ ts: string | undefined; fileCount: number; totalFiles: number }> {
    return this.opQueue.run(() => this.snapshotNowImpl());
  }

  private async snapshotNowImpl(): Promise<{ ts: string | undefined; fileCount: number; totalFiles: number }> {
    const rels = await this.listWorkspaceFiles();
    const { ts, files } = await this.writeSnapshot(rels);
    await this.pruneOldSnapshots();
    return { ts, fileCount: files.length, totalFiles: rels.length };
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const root = this.snapshotsRootPath();
    let dirs: string[] = [];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
        .sort(compareSnapshotNames).reverse();
    } catch {
      return [];
    }
    const metas = await Promise.all(dirs.map(async d => {
      const buf = await this.readRegularFile(path.join(root, d, 'meta.json'));
      return buf ? parseManifest(buf.toString('utf8')) : undefined;
    }));
    return metas.filter((m): m is SnapshotInfo => m !== undefined);
  }

  async latestCheckpoint(): Promise<SnapshotInfo | undefined> {
    return findLatestCheckpoint(await this.listSnapshots());
  }

  // Resolve a timestamp or label to a timestamp. If the input matches the
  // timestamp format AND a snapshot with that timestamp exists, return it.
  // Otherwise, search for the most recent snapshot whose label matches
  // (case-insensitive, exact then substring). Manual checkpoints are
  // preferred over auto snapshots to avoid internal backup labels from
  // shadowing user-created checkpoints.
  async resolveTimestamp(input: string): Promise<string | undefined> {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    if (isValidSnapshotName(trimmed)) {
      const manifest = await this.readManifest(trimmed);
      if (manifest) return trimmed;
    }
    const snapshots = await this.listSnapshots();
    const lower = trimmed.toLowerCase();
    // Prefer manual checkpoints over auto snapshots for label matching
    const manual = snapshots.filter(s => !s.auto);
    const manualExact = manual.find(s => s.label?.toLowerCase() === lower);
    if (manualExact) return manualExact.timestamp;
    const manualSubstr = manual.find(s => s.label?.toLowerCase().includes(lower));
    if (manualSubstr) return manualSubstr.timestamp;
    // Fall back to auto snapshots if no manual match
    const autoExact = snapshots.find(s => s.auto && s.label?.toLowerCase() === lower);
    if (autoExact) return autoExact.timestamp;
    const autoSubstr = snapshots.find(s => s.auto && s.label?.toLowerCase().includes(lower));
    return autoSubstr?.timestamp;
  }

  restoreFile(ts: string, rel: string): Promise<{ ok: boolean; skipped?: string; backupTs?: string }> {
    return this.opQueue.run(() => this.restoreFileImpl(ts, rel));
  }

  private async restoreFileImpl(ts: string, rel: string): Promise<{ ok: boolean; skipped?: string; backupTs?: string }> {
    if (!isValidSnapshotName(ts)) return { ok: false };
    if (typeof rel !== 'string') return { ok: false };
    if (this.shouldExclude(rel)) return { ok: false };
    const src = await this.resolveSnapshotPath(ts, rel);
    if (!src) return { ok: false };
    // Verify the snapshot file actually exists before creating a backup.
    try {
      await fs.access(src);
    } catch {
      return { ok: false };
    }
    const backup = await this.backupBeforeRestore([rel]);
    if (!(await this.canOverwrite(rel, backup.files))) {
      await this.pruneOldSnapshots();
      return { ok: false, skipped: rel };
    }
    const ok = await this.copyInto(src, rel);
    if (ok && backup.ts) this.lastBackupTs = backup.ts;
    await this.pruneOldSnapshots();
    // The snapshot file exists (verified above), so a copy failure is a
    // destination-side problem (e.g. path blocked by a non-directory), not a
    // "file not in snapshot" case. Report it as skipped so the caller gives an
    // accurate reason instead of "not found in snapshot".
    if (!ok) return { ok: false, skipped: rel, backupTs: backup.ts };
    return { ok, backupTs: backup.ts };
  }

  restoreSnapshot(ts: string): Promise<{ restored: number; skipped: string[]; backupTs?: string }> {
    return this.opQueue.run(() => this.restoreSnapshotImpl(ts));
  }

  private async restoreSnapshotImpl(ts: string): Promise<{ restored: number; skipped: string[]; backupTs?: string }> {
    if (!isValidSnapshotName(ts)) return { restored: 0, skipped: [] };
    const snap = await this.readManifest(ts);
    if (!snap) return { restored: 0, skipped: [] };
    const files = [...new Set(snap.files)];
    const backup = await this.backupBeforeRestore(files);
    let restored = 0;
    const skipped: string[] = [];
    for (const rel of files) {
      const src = await this.resolveSnapshotPath(ts, rel);
      if (!src) { skipped.push(rel); continue; }
      if (!(await this.canOverwrite(rel, backup.files))) { skipped.push(rel); continue; }
      if (await this.copyInto(src, rel)) restored++;
      else skipped.push(rel);
    }
    if (restored > 0 && backup.ts) this.lastBackupTs = backup.ts;
    await this.pruneOldSnapshots();
    return { restored, skipped, backupTs: backup.ts };
  }

  restoreCheckpointExact(ts: string): Promise<{ restored: number; deleted: number; skipped: string[]; backupTs?: string } | undefined> {
    return this.opQueue.run(() => this.restoreCheckpointExactImpl(ts));
  }

  private async restoreCheckpointExactImpl(ts: string): Promise<{ restored: number; deleted: number; skipped: string[]; backupTs?: string } | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    const snap = await this.readManifest(ts);
    if (!snap || !isProtectedCheckpoint(snap)) return undefined;
    const snapFiles = [...new Set(snap.files)];
    const current = await this.listWorkspaceFiles();
    const toDelete = filesToDeleteForExactRestore(current, snapFiles);
    const backup = await this.backupBeforeRestore([...snapFiles, ...toDelete]);

    let deleted = 0;
    const skipped: string[] = [];
    for (const rel of toDelete) {
      // Never delete a file that could not be backed up (size cap, read
      // error). Report it so the caller knows the workspace does not
      // exactly match the checkpoint.
      if (!backup.files.has(rel)) { skipped.push(rel); continue; }
      if (await this.deleteWorkspaceFile(rel)) deleted++;
      else skipped.push(rel);
    }

    let restored = 0;
    for (const rel of snapFiles) {
      const src = await this.resolveSnapshotPath(ts, rel);
      if (!src) { skipped.push(rel); continue; }
      if (!(await this.canOverwrite(rel, backup.files))) { skipped.push(rel); continue; }
      if (await this.copyInto(src, rel)) restored++;
      else skipped.push(rel);
    }

    const deletedRels = toDelete.filter(r => backup.files.has(r));
    await this.removeEmptyDirs(deletedRels);
    if ((restored > 0 || deleted > 0) && backup.ts) this.lastBackupTs = backup.ts;
    await this.pruneOldSnapshots();
    return { restored, deleted, skipped, backupTs: backup.ts };
  }

  undo(): Promise<{ restored: number; skipped: string[] } | undefined> {
    return this.opQueue.run(() => this.undoImpl());
  }

  private async undoImpl(): Promise<{ restored: number; skipped: string[] } | undefined> {
    if (!this.lastBackupTs) return undefined;
    const ts = this.lastBackupTs;
    const snap = await this.readManifest(ts);
    if (!snap) return undefined;
    const backup = await this.backupBeforeRestore(snap.files);
    let restored = 0;
    const skipped: string[] = [];
    for (const rel of snap.files) {
      const src = await this.resolveSnapshotPath(ts, rel);
      if (!src) { skipped.push(rel); continue; }
      if (!(await this.canOverwrite(rel, backup.files))) { skipped.push(rel); continue; }
      if (await this.copyInto(src, rel)) restored++;
      else skipped.push(rel);
    }
    if (restored > 0) {
      // Undo succeeded: chain to the new backup so undo-the-undo works
      this.lastBackupTs = backup.ts ?? undefined;
    }
    // If restored === 0, leave lastBackupTs unchanged so the user can retry
    await this.pruneOldSnapshots();
    return { restored, skipped };
  }

  async deleteSnapshot(ts: string): Promise<boolean> {
    if (!isValidSnapshotName(ts)) return false;
    const root = this.snapshotsRootPath();
    const dir = path.join(root, ts);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  async getSnapshotFiles(ts: string): Promise<string[] | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    const snap = await this.readManifest(ts);
    if (!snap) return undefined;
    return snap.files;
  }

  async diffSummary(ts: string): Promise<{ modified: string[]; added: string[]; deleted: string[] } | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    const snap = await this.readManifest(ts);
    if (!snap) return undefined;

    const currentFiles = await this.listWorkspaceFiles();
    const currentSet = new Set(currentFiles);
    const snapFiles = [...new Set(snap.files)];
    const snapSet = new Set(snapFiles);

    const deleted = snapFiles.filter(f => !currentSet.has(f));
    const added = currentFiles.filter(f => !snapSet.has(f));

    const modified: string[] = [];
    const common = snapFiles.filter(f => currentSet.has(f));
    for (const rel of common) {
      const snapPath = await this.resolveSnapshotPath(ts, rel);
      if (!snapPath) { modified.push(rel); continue; }
      const workspacePath = path.join(this.root, rel);
      // Compare file sizes first. If they differ, the files are modified
      // and we skip reading their contents entirely -- avoids loading two
      // full copies of large files into memory just to prove inequality.
      const [snapStat, curStat] = await Promise.all([
        this.regularFileSize(snapPath),
        this.regularFileSize(workspacePath),
      ]);
      if (snapStat === undefined || curStat === undefined) { modified.push(rel); continue; }
      if (snapStat !== curStat) { modified.push(rel); continue; }
      // Same size: read and compare bytes to confirm.
      const [snapBuf, curBuf] = await Promise.all([
        this.readRegularFile(snapPath),
        this.readRegularFile(workspacePath),
      ]);
      if (!snapBuf || !curBuf || !snapBuf.equals(curBuf)) modified.push(rel);
    }

    return { modified, added, deleted };
  }

  // Read a path only if it is a regular file. readFile on a FIFO or socket
  // blocks forever, so every read of agent-influenced or store paths must
  // go through this guard.
  private async readRegularFile(p: string): Promise<Buffer | undefined> {
    try {
      const st = await fs.lstat(p);
      if (!st.isFile()) return undefined;
      return await fs.readFile(p);
    } catch {
      return undefined;
    }
  }

  // Size in bytes of a path only if it is a regular file, else undefined.
  private async regularFileSize(p: string): Promise<number | undefined> {
    try {
      const st = await fs.lstat(p);
      if (!st.isFile()) return undefined;
      return st.size;
    } catch {
      return undefined;
    }
  }

  async readFile(ts: string, rel: string): Promise<string | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    if (typeof rel !== 'string') return undefined;
    // Never read a reserved store path (e.g. root meta.json resolves to the
    // snapshot manifest, not a captured workspace file).
    if (this.shouldExclude(rel)) return undefined;
    const snapPath = await this.resolveSnapshotPath(ts, rel);
    if (!snapPath) return undefined;
    const buf = await this.readRegularFile(snapPath);
    if (!buf || isBinaryBuffer(buf)) return undefined;
    return buf.toString('utf8');
  }

  async diff(ts: string, rel: string): Promise<string | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    if (typeof rel !== 'string') return undefined;
    // Reject paths inside the store or other excluded directories
    if (this.shouldExclude(rel)) return undefined;
    // Verify the snapshot exists before diffing. Without this check, a
    // nonexistent timestamp produces a misleading "file added" diff instead
    // of returning undefined (snapshot not found).
    const manifest = await this.readManifest(ts);
    if (!manifest) return undefined;
    const workspacePath = path.join(this.root, rel);
    if (!isInside(this.root, workspacePath)) return undefined;
    if (!(await isRealPathInside(this.root, workspacePath))) return undefined;

    const snapPath = await this.resolveSnapshotPath(ts, rel);

    let snapBuf: Buffer;
    let snapExists = false;
    if (snapPath) {
      const buf = await this.readRegularFile(snapPath);
      if (buf) { snapBuf = buf; snapExists = true; }
      else { snapBuf = Buffer.alloc(0); }
    } else {
      snapBuf = Buffer.alloc(0);
    }

    let currentBuf: Buffer;
    let currentExists = false;
    const curBuf = await this.readRegularFile(workspacePath);
    if (curBuf) { currentBuf = curBuf; currentExists = true; }
    else { currentBuf = Buffer.alloc(0); }

    // Neither exists: nothing to diff
    if (!snapExists && !currentExists) return undefined;

    // One side missing with empty content: report deletion/addition of empty file
    if (snapExists && !currentExists && snapBuf.length === 0) {
      return `--- a/${rel} (snapshot ${ts})\n+++ /dev/null\n\nEmpty file was deleted.`;
    }
    if (!snapExists && currentExists && currentBuf.length === 0) {
      return `--- /dev/null\n+++ b/${rel} (current)\n\nEmpty file was created.`;
    }

    if (isBinaryBuffer(snapBuf) || isBinaryBuffer(currentBuf)) {
      const same = snapBuf.equals(currentBuf);
      if (same) return '';
      if (snapExists && !currentExists) {
        return `Binary file ${rel} was deleted (existed in snapshot ${ts}, ${snapBuf.length} bytes).`;
      }
      if (!snapExists && currentExists) {
        return `Binary file ${rel} was added since snapshot ${ts} (${currentBuf.length} bytes).`;
      }
      return `Binary file ${rel} differs (snapshot ${ts}: ${snapBuf.length} bytes, current: ${currentBuf.length} bytes).`;
    }

    const snapContent = snapBuf.toString('utf8');
    const currentContent = currentBuf.toString('utf8');

    // Guard against O(n*m) memory explosion on large files. A 5000x5000
    // table is ~200MB which is acceptable; beyond that, fall back to a
    // summary. The product of the two line counts is the real constraint.
    const snapLineCount = countLines(snapContent);
    const currentLineCount = countLines(currentContent);
    if (snapLineCount > 5_000 || currentLineCount > 5_000) {
      if (snapContent === currentContent) return '';
      return [
        `--- a/${rel} (snapshot ${ts})`,
        `+++ b/${rel} (current)`,
        `File too large for line-level diff (${snapLineCount} / ${currentLineCount} lines).`,
        `Snapshot size: ${snapBuf.length} bytes, current size: ${currentBuf.length} bytes.`,
      ].join('\n');
    }

    return unifiedDiff(rel, snapContent, currentContent, ts, snapExists, currentExists);
  }

  private async resolveSnapshotPath(ts: string, relPath: string): Promise<string | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    if (typeof relPath !== 'string') return undefined;
    const snapDir = path.join(this.root, this.folderName, 'snapshots', ts);
    const full = path.join(snapDir, relPath);
    if (!isInside(snapDir, full)) return undefined;
    if (!(await isRealPathInside(snapDir, full))) return undefined;
    return full;
  }

  private async readManifest(ts: string): Promise<SnapshotInfo | undefined> {
    const snapRoot = this.snapshotsRootPath();
    const metaPath = path.join(snapRoot, ts, 'meta.json');
    const buf = await this.readRegularFile(metaPath);
    return buf ? parseManifest(buf.toString('utf8')) : undefined;
  }

  private async backupBeforeRestore(rels: string[]): Promise<{ ts: string | undefined; files: Set<string> }> {
    const { ts, files } = await this.writeSnapshot(rels, 'pre-restore backup', true);
    return { ts, files: new Set(files) };
  }

  private async canOverwrite(rel: string, backedUp: Set<string>): Promise<boolean> {
    const abs = path.join(this.root, rel);
    let exists = false;
    try {
      await fs.access(abs);
      exists = true;
    } catch {
      exists = false;
    }
    return canRestoreSafely(exists, backedUp.has(rel));
  }

  private async copyInto(src: string, rel: string): Promise<boolean> {
    // Verify source is a regular file (copyFile on a FIFO blocks forever)
    try {
      const srcSt = await fs.lstat(src);
      if (!srcSt.isFile()) return false;
    } catch {
      return false;
    }
    // Never write into excluded directories (prevents store corruption via tampered manifests)
    if (this.shouldExclude(rel)) return false;
    const dest = path.join(this.root, rel);
    if (!isInside(this.root, dest) || !(await isRealPathInside(this.root, dest))) return false;
    let existingMode: number | undefined;
    try {
      const st = await fs.lstat(dest);
      if (st.isSymbolicLink()) return false;
      existingMode = st.mode;
    } catch {
      // dest does not exist yet
    }
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      // Make writable if read-only, so copyFile can overwrite
      if (existingMode !== undefined && !(existingMode & 0o200)) {
        await fs.chmod(dest, existingMode | 0o200);
      }
      await fs.copyFile(src, dest);
      // copyFile preserves the source file's permissions, which is the
      // snapshot's original mode. Do NOT restore the previous mode here --
      // the whole point of a restore is to bring back the file as it was.
      return true;
    } catch {
      return false;
    }
  }

  private async deleteWorkspaceFile(rel: string): Promise<boolean> {
    const target = path.join(this.root, rel);
    if (!isInside(this.root, target) || !(await isRealPathInside(this.root, target))) return false;
    try {
      await fs.rm(target, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private async removeEmptyDirs(deletedRels: string[]) {
    if (deletedRels.length === 0) return;
    // Collect the top-level directories that contained deleted files, then
    // do a bottom-up empty-dir sweep within those trees. This catches both
    // the direct parents AND any sibling empty subdirectories that were
    // added after the checkpoint.
    const topDirs = new Set<string>();
    for (const rel of deletedRels) {
      const first = rel.indexOf('/');
      topDirs.add(first === -1 ? '' : rel.slice(0, first));
    }
    // Also add direct parent candidates for files at the root level
    for (const dir of emptyDirCandidates(deletedRels)) {
      const target = path.join(this.root, dir);
      if (!isInside(this.root, target) || !(await isRealPathInside(this.root, target))) continue;
      try {
        await fs.rmdir(target);
      } catch {
        // not empty or already gone
      }
    }
    // For each top-level directory tree that had deletions, sweep empty
    // subdirectories bottom-up (catches sibling empty dirs like tests/fixtures/).
    for (const top of topDirs) {
      if (!top) continue; // files at workspace root, no dir to sweep
      const topAbs = path.join(this.root, top);
      await this.sweepEmptyDirs(topAbs);
    }
  }

  private async sweepEmptyDirs(dir: string): Promise<boolean> {
    if (!isInside(this.root, dir)) return false;
    const rel = toWorkspaceRel(this.root, dir);
    if (rel && this.shouldExclude(rel)) return false;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    // Recurse into subdirs first (bottom-up)
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const abs = path.join(dir, entry.name);
      const childRel = toWorkspaceRel(this.root, abs);
      if (!childRel) continue;
      if (isWithinSnapshotFolder(childRel, this.folderName)) continue;
      if (this.shouldExclude(childRel)) continue;
      await this.sweepEmptyDirs(abs);
    }
    // Try to remove this dir (fails if non-empty -- safe)
    try {
      await fs.rmdir(dir);
      return true;
    } catch {
      return false;
    }
  }


  private async pruneOldSnapshots() {
    const root = this.snapshotsRootPath();
    try {
      const dirEntries = await fs.readdir(root, { withFileTypes: true });
      const dirs = dirEntries.filter(e => e.isDirectory()).map(e => e.name);
      const entries: SnapshotEntry[] = [];
      for (const d of dirs) {
        if (!isValidSnapshotName(d)) {
          // Remove directories with invalid names (orphans from interrupted ops)
          await fs.rm(path.join(root, d), { recursive: true, force: true }).catch(() => {});
          continue;
        }
        // Protect the current undo target from pruning
        if (d === this.lastBackupTs) {
          entries.push({ name: d, isCheckpoint: true });
          continue;
        }
        const meta = await this.readManifestSafe(root, d);
        if (meta === undefined) {
          // No manifest. This is either an in-flight write from a concurrent
          // operation (manifest arrives within milliseconds) or a crashed-write
          // orphan (manifest will never arrive). Distinguish by directory age:
          // remove it only if it is older than the grace period, so genuine
          // in-flight writes are never touched but crashed orphans get cleaned.
          if (await this.isStaleOrphan(path.join(root, d))) {
            await fs.rm(path.join(root, d), { recursive: true, force: true }).catch(() => {});
          }
          continue;
        }
        // null = corrupt manifest, treat as pruneable non-checkpoint
        entries.push({ name: d, isCheckpoint: meta !== null && isProtectedCheckpoint(meta) });
      }
      for (const name of selectSnapshotsToPrune(entries, this.maxSnapshots)) {
        await fs.rm(path.join(root, name), { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  private async readManifestSafe(root: string, dir: string): Promise<SnapshotInfo | null | undefined> {
    // Returns: SnapshotInfo if valid manifest, null if manifest exists but is invalid,
    // undefined if meta.json does not exist or is not a regular file.
    const metaPath = path.join(root, dir, 'meta.json');
    const buf = await this.readRegularFile(metaPath);
    if (!buf) {
      // Distinguish ENOENT (in-flight write) from other failures
      try { await fs.lstat(metaPath); return null; } catch { return undefined; }
    }
    return parseManifest(buf.toString('utf8')) ?? null;
  }

  // A manifest-less snapshot directory is a crashed-write orphan (rather than
  // an in-flight write) if it has not been modified within the grace period.
  // Snapshot writes complete in milliseconds, so a dir untouched for the grace
  // window will never gain a manifest.
  private async isStaleOrphan(dir: string): Promise<boolean> {
    try {
      const st = await fs.stat(dir);
      return (Date.now() - st.mtimeMs) > ORPHAN_GRACE_MS;
    } catch {
      return false;
    }
  }


  // --- File watcher for auto-burst checkpoints ---

  private watcher: fsWatch.FSWatcher | undefined;
  private watchModified = new Set<string>();
  private watchTimer: ReturnType<typeof setTimeout> | undefined;
  private watchQuietMs = 2500;
  private watchBurstMin = 10;

  startWatching(opts?: { quietMs?: number; burstMinFiles?: number }): void {
    if (this.watcher) return; // already watching
    // Validate: a non-positive or non-finite quiet time / threshold would
    // make the watcher fire a burst on every single change, defeating the
    // debounce. Fall back to the defaults for invalid values.
    if (opts?.quietMs !== undefined && Number.isFinite(opts.quietMs) && opts.quietMs > 0) {
      this.watchQuietMs = opts.quietMs;
    }
    if (opts?.burstMinFiles !== undefined && Number.isFinite(opts.burstMinFiles) && opts.burstMinFiles >= 1) {
      this.watchBurstMin = Math.floor(opts.burstMinFiles);
    }

    try {
      this.watcher = fsWatch.watch(this.root, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        // Normalize to posix separators
        const rel = filename.split(path.sep).join(path.posix.sep);
        // Ignore changes within the snapshot folder (prevents infinite loops)
        if (isWithinSnapshotFolder(rel, this.folderName)) return;
        // Ignore excluded patterns
        if (this.shouldExclude(rel)) return;

        this.watchModified.add(rel);
        this.resetWatchTimer();
      });

      this.watcher.on('error', () => {
        // fs.watch can be flaky; silently stop on error
        this.stopWatching();
      });
    } catch {
      // watch() can throw on unsupported platforms; silently ignore
    }
  }

  stopWatching(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = undefined;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    this.watchModified.clear();
  }

  private resetWatchTimer(): void {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    this.watchTimer = setTimeout(() => {
      this.watchTimer = undefined;
      void this.flushWatchBurst();
    }, this.watchQuietMs);
  }

  private async flushWatchBurst(): Promise<void> {
    // Cheap pre-check on the raw event count to avoid the lstat sweep when
    // clearly below threshold. The authoritative check is on real files below.
    if (this.watchModified.size < this.watchBurstMin) return;
    const candidates = [...this.watchModified];
    this.watchModified.clear();
    // Keep only entries that are currently regular files. Watch events can
    // include directories or transient entries, which would otherwise both
    // inflate the label count and let the burst fire below the real-file
    // threshold.
    const files: string[] = [];
    for (const rel of candidates) {
      try {
        const st = await fs.lstat(path.join(this.root, rel));
        if (st.isFile()) files.push(rel);
      } catch {
        // gone or inaccessible; skip
      }
    }
    // Enforce the threshold against the actual number of changed files, not
    // the raw watch-event count (which may include directories/transients).
    if (files.length < this.watchBurstMin) {
      // Not enough real files changed. Put them back so a later event that
      // pushes the count over the threshold still triggers a burst that
      // includes them.
      for (const rel of files) this.watchModified.add(rel);
      return;
    }
    // Run the write+prune as one operation on the shared queue so an
    // auto-burst never overlaps a concurrent restore's workspace file copies.
    const label = `auto: ${files.length} files changed`;
    await this.opQueue.run(async () => {
      await this.writeSnapshot(files, label, true);
      await this.pruneOldSnapshots();
    });
  }
}

// Count newlines in a string. Used to guard the diff against huge files.
function countLines(s: string): number {
  let count = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 10) count++;
  }
  return count + 1;
}

// A shared strict UTF-8 decoder. `fatal: true` makes decode() throw on any
// byte sequence that is not valid UTF-8, rather than silently substituting
// U+FFFD. Reused across calls to avoid re-allocating per buffer.
const strictUtf8Decoder = new TextDecoder('utf8', { fatal: true });

// Detect content that must not be treated as UTF-8 text.
function isBinaryBuffer(buf: Buffer): boolean {
  // A NUL byte anywhere marks the content as binary. Scan the whole buffer
  // (Buffer.indexOf is a fast native scan) rather than only the first 8KB,
  // so files with binary data past the first page are not mistaken for text
  // and returned/diffed with raw NUL bytes. Buffers are already bounded by
  // maxFileSizeBytes, so a full scan is cheap.
  if (buf.indexOf(0) !== -1) return true;
  // Content with no NUL can still be invalid UTF-8 (Latin-1/Windows-1252 text,
  // a truncated multi-byte sequence, UTF-16 without NULs in the sampled range,
  // etc.). Decoding such bytes with toString('utf8') is lossy: every invalid
  // byte collapses to U+FFFD, so a diff/read would not round-trip and, worse,
  // two different invalid bytes (0xE9 vs 0xEA) both become U+FFFD and a real
  // change is reported as no change. Treat anything that is not valid UTF-8 as
  // binary so it goes through the byte-accurate path instead of a lossy decode.
  try {
    strictUtf8Decoder.decode(buf);
    return false;
  } catch {
    return true;
  }
}

// Unified diff with proper context hunks. Uses a simple O(n*m) LCS to find
// matching lines, then emits standard unified-diff hunks with 3 lines of
// context. Acceptable for the file sizes agents typically snapshot.

// Format one side of a hunk header. Per the unified-diff spec (and git), the
// ",count" part is omitted when count === 1, e.g. "5" rather than "5,1".
function hunkRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

// Full hunk header: "@@ -<oldRange> +<newRange> @@".
function hunkHeader(oldStart: number, oldCount: number, newStart: number, newCount: number): string {
  return `@@ -${hunkRange(oldStart, oldCount)} +${hunkRange(newStart, newCount)} @@`;
}

// Split content into lines. Drops the trailing empty element that split('\n')
// produces when a file ends with a newline (which is normal for text files).
// Without this, every file ending in \n would show a phantom empty context line.
function splitLines(content: string): string[] {
  if (content === '') return [];
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const CONTEXT_LINES = 3;

function unifiedDiff(filename: string, oldContent: string, newContent: string, oldLabel: string, oldExists = true, newExists = true): string {
  if (oldContent === newContent) return '';

  // When the current file is gone, show a full deletion diff.
  if (!newExists && newContent === '') {
    const oldLines = splitLines(oldContent);
    const out: string[] = [
      `--- a/${filename} (snapshot ${oldLabel})`,
      `+++ /dev/null`,
      hunkHeader(1, oldLines.length, 0, 0),
    ];
    for (const line of oldLines) {
      out.push(`-${line}`);
    }
    return out.join('\n');
  }

  // When the snapshot version didn't exist but a file now exists, show full addition.
  if (!oldExists && oldContent === '') {
    const newLines = splitLines(newContent);
    const out: string[] = [
      `--- /dev/null`,
      `+++ b/${filename} (current)`,
      hunkHeader(0, 0, 1, newLines.length),
    ];
    for (const line of newLines) {
      out.push(`+${line}`);
    }
    return out.join('\n');
  }

  const oldEndsWithNewline = oldContent.endsWith('\n');
  const newEndsWithNewline = newContent.endsWith('\n');
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);

  // If lines are identical but trailing newline differs, show the last line
  // as a change with the standard "No newline at end of file" marker.
  if (oldLines.length === newLines.length && oldLines.every((l, i) => l === newLines[i])) {
    if (oldEndsWithNewline === newEndsWithNewline) return '';
    const lastLine = oldLines[oldLines.length - 1];
    const n = oldLines.length;
    const ctxStart = Math.max(0, n - 1 - CONTEXT_LINES);
    const ctxCount = n - 1 - ctxStart;
    const out: string[] = [
      `--- a/${filename} (snapshot ${oldLabel})`,
      `+++ b/${filename} (current)`,
      hunkHeader(ctxStart + 1, ctxCount + 1, ctxStart + 1, ctxCount + 1),
    ];
    for (let i = ctxStart; i < n - 1; i++) out.push(` ${oldLines[i]}`);
    out.push(`-${lastLine}`);
    if (!oldEndsWithNewline) out.push('\\ No newline at end of file');
    out.push(`+${lastLine}`);
    if (!newEndsWithNewline) out.push('\\ No newline at end of file');
    return out.join('\n');
  }

  // A line with no trailing newline is a distinct token from the same text
  // with a newline: it can only match another no-newline line. Append a
  // sentinel to the last line of each side that lacks a trailing newline so
  // the LCS never matches a no-newline last line against a newline-terminated
  // line. Without this, when both sides lack a trailing newline and the new
  // file's last line equals an interior old line, the LCS keeps it as a plain
  // context line, the "No newline at end of file" marker is never emitted for
  // it, and applying the diff restores a phantom trailing newline. The marker
  // itself is emitted in buildHunks, which uses the sentinel-free line arrays,
  // so the sentinel only steers matching and never leaks into the output.
  let diffOldLines = oldLines;
  let diffNewLines = newLines;
  const needOldSentinel = !oldEndsWithNewline && oldLines.length > 0;
  const needNewSentinel = !newEndsWithNewline && newLines.length > 0;
  if (needOldSentinel || needNewSentinel) {
    diffOldLines = [...oldLines];
    diffNewLines = [...newLines];
    if (needOldSentinel) {
      diffOldLines[diffOldLines.length - 1] += '\x00NO_NL';
    }
    if (needNewSentinel) {
      diffNewLines[diffNewLines.length - 1] += '\x00NO_NL';
    }
  }
  const edits = myersDiff(diffOldLines, diffNewLines);
  const hunks = buildHunks(edits, oldLines, newLines, oldEndsWithNewline, newEndsWithNewline);

  const out: string[] = [
    `--- a/${filename} (snapshot ${oldLabel})`,
    `+++ b/${filename} (current)`,
  ];
  for (const hunk of hunks) {
    out.push(hunk);
  }
  return out.join('\n');
}

interface Edit {
  type: 'keep' | 'delete' | 'insert';
  oldIdx: number;
  newIdx: number;
}

// Simple LCS-based edit script. Computes which old lines to keep, which to
// delete, and which new lines to insert. O(n*m) space/time but fine for
// typical source files under a few thousand lines.
function myersDiff(oldLines: string[], newLines: string[]): Edit[] {
  const n = oldLines.length;
  const m = newLines.length;
  const width = m + 1;

  // LCS table stored as a flat Int32Array (indexed i*width + j) rather than
  // an array-of-arrays of boxed JS numbers. This cuts the table's memory
  // footprint several-fold, which matters at the guard boundary where n and
  // m approach 5000 (a 5000x5000 table). LCS values never exceed min(n,m),
  // well within Int32 range.
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * width + j];
        const right = dp[i * width + (j + 1)];
        dp[i * width + j] = down > right ? down : right;
      }
    }
  }

  // Trace back to produce edit script. Prefer delete before insert so the
  // output matches standard unified-diff convention (removals then additions).
  const edits: Edit[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j]) {
      edits.push({ type: 'keep', oldIdx: i, newIdx: j });
      i++; j++;
    } else if (i < n && (j >= m || dp[(i + 1) * width + j] >= dp[i * width + (j + 1)])) {
      edits.push({ type: 'delete', oldIdx: i, newIdx: j });
      i++;
    } else {
      edits.push({ type: 'insert', oldIdx: i, newIdx: j });
      j++;
    }
  }
  return edits;
}

// Group edits into unified-diff hunks with context lines.
function buildHunks(edits: Edit[], oldLines: string[], newLines: string[], oldEndsWithNewline = true, newEndsWithNewline = true): string[] {
  // Find runs of changes separated by more than 2*CONTEXT_LINES of keeps.
  const groups: Edit[][] = [];
  let current: Edit[] = [];
  let keepRun = 0;

  for (const e of edits) {
    if (e.type === 'keep') {
      keepRun++;
      if (keepRun > CONTEXT_LINES * 2 && current.length > 0) {
        // A run of more than 2*CONTEXT_LINES keeps separates two hunks. Close
        // the current group, but seed the new one with the last CONTEXT_LINES-1
        // keeps so that when the next change arrives it still has a full
        // CONTEXT_LINES of leading context (those keeps plus this one). Without
        // this carry-over the next hunk would start with too few leading
        // context lines. The carried keeps are always trimmed out of the
        // closed group's trailing context, so no line is emitted twice.
        groups.push(current);
        const carry = CONTEXT_LINES - 1 > 0 ? current.slice(-(CONTEXT_LINES - 1)) : [];
        current = [...carry];
        keepRun = current.length + 1;
      }
      current.push(e);
    } else {
      keepRun = 0;
      current.push(e);
    }
  }
  if (current.length > 0) groups.push(current);

  const output: string[] = [];
  for (const group of groups) {
    // Trim leading/trailing keeps to at most CONTEXT_LINES
    const firstChange = group.findIndex(e => e.type !== 'keep');
    const lastChange = group.length - 1 - [...group].reverse().findIndex(e => e.type !== 'keep');

    if (firstChange === -1) continue; // all keeps, no changes

    const start = Math.max(0, firstChange - CONTEXT_LINES);
    const end = Math.min(group.length - 1, lastChange + CONTEXT_LINES);
    const slice = group.slice(start, end + 1);

    // Compute hunk header positions
    let oldStart = slice[0].oldIdx + 1;
    let newStart = slice[0].newIdx + 1;
    let oldCount = 0, newCount = 0;
    const lines: string[] = [];
    for (const e of slice) {
      switch (e.type) {
        case 'keep':
          lines.push(` ${oldLines[e.oldIdx]}`);
          if (e.oldIdx === oldLines.length - 1 && !oldEndsWithNewline) {
            lines.push('\\ No newline at end of file');
          }
          oldCount++; newCount++;
          break;
        case 'delete':
          lines.push(`-${oldLines[e.oldIdx]}`);
          if (e.oldIdx === oldLines.length - 1 && !oldEndsWithNewline) {
            lines.push('\\ No newline at end of file');
          }
          oldCount++;
          break;
        case 'insert':
          lines.push(`+${newLines[e.newIdx]}`);
          if (e.newIdx === newLines.length - 1 && !newEndsWithNewline) {
            lines.push('\\ No newline at end of file');
          }
          newCount++;
          break;
      }
    }
    // Unified-diff convention: when a side contributes zero lines, its
    // start is the line BEFORE the change (0 when inserting at the top).
    // patch(1) rejects hunks like "-1,0" on an empty file.
    if (oldCount === 0) oldStart = slice[0].oldIdx;
    if (newCount === 0) newStart = slice[0].newIdx;
    output.push(hunkHeader(oldStart, oldCount, newStart, newCount));
    output.push(...lines);
  }
  return output;
}
