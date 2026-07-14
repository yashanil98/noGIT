import * as fs from 'node:fs/promises';
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
  const result: SnapshotInfo = { timestamp: obj.timestamp, files: obj.files as string[] };
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

// --- latestCheckpoint.ts (verbatim logic) ---
function findLatestCheckpoint(snapshots: SnapshotInfo[]): SnapshotInfo | undefined {
  let best: SnapshotInfo | undefined;
  for (const s of snapshots) {
    if (!s.label || s.label.length === 0) continue;
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
  '**/.git/**',
  '**/.nogit/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
];

const COPY_CONCURRENCY = 16;

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

  constructor(opts: EngineOptions) {
    this.root = path.resolve(opts.root);
    this.folderName = opts.snapshotFolderName ?? '.nogit';
    this.excludes = opts.excludePatterns ?? DEFAULT_EXCLUDES;
    this.maxBytes = opts.maxFileSizeBytes ?? 5_000_000;
    this.maxSnapshots = opts.maxSnapshots ?? 48;
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
    return matchesAny(this.excludes, rel);
  }

  private async getSnapshotsRoot(): Promise<string> {
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

  private async writeSnapshotImpl(rels: string[], label?: string, auto = false): Promise<{ ts: string | undefined; files: string[] }> {
    const snapRoot = await this.getSnapshotsRoot();
    let existing: string[] = [];
    try {
      const entries = await fs.readdir(snapRoot, { withFileTypes: true });
      existing = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      // treat as empty
    }
    const ts = uniqueSnapshotName(formatTimestamp(new Date()), existing);
    const snapDir = path.join(snapRoot, ts);
    await fs.mkdir(snapDir, { recursive: true });

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
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf8');
    await fs.rename(tmpPath, metaPath);

    return { ts, files: copied };
  }

  async checkpoint(label: string): Promise<{ ts: string | undefined; fileCount: number }> {
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (!trimmed) return { ts: undefined, fileCount: 0 };
    const rels = await this.listWorkspaceFiles();
    const { ts, files } = await this.writeSnapshot(rels, trimmed);
    await this.pruneOldSnapshots();
    return { ts, fileCount: files.length };
  }

  async snapshotNow(): Promise<{ ts: string | undefined; fileCount: number }> {
    const rels = await this.listWorkspaceFiles();
    const { ts, files } = await this.writeSnapshot(rels);
    await this.pruneOldSnapshots();
    return { ts, fileCount: files.length };
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    const root = await this.getSnapshotsRoot();
    let dirs: string[] = [];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      dirs = entries.filter(e => e.isDirectory()).map(e => e.name)
        .sort(compareSnapshotNames).reverse();
    } catch {
      return [];
    }
    const metas = await Promise.all(dirs.map(async d => {
      try {
        return parseManifest(await fs.readFile(path.join(root, d, 'meta.json'), 'utf8'));
      } catch {
        return undefined;
      }
    }));
    return metas.filter((m): m is SnapshotInfo => m !== undefined);
  }

  async latestCheckpoint(): Promise<SnapshotInfo | undefined> {
    return findLatestCheckpoint(await this.listSnapshots());
  }

  async restoreFile(ts: string, rel: string): Promise<{ ok: boolean; skipped?: string }> {
    if (!isValidSnapshotName(ts)) return { ok: false };
    if (typeof rel !== 'string') return { ok: false };
    const src = await this.resolveSnapshotPath(ts, rel);
    if (!src) return { ok: false };
    const backup = await this.backupBeforeRestore([rel]);
    if (!(await this.canOverwrite(rel, backup.files))) {
      return { ok: false, skipped: rel };
    }
    const ok = await this.copyInto(src, rel);
    return { ok };
  }

  async restoreSnapshot(ts: string): Promise<{ restored: number; skipped: string[] }> {
    if (!isValidSnapshotName(ts)) return { restored: 0, skipped: [] };
    const snap = await this.readManifest(ts);
    if (!snap) return { restored: 0, skipped: [] };
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
    return { restored, skipped };
  }

  async restoreCheckpointExact(ts: string): Promise<{ restored: number; deleted: number; skipped: string[] } | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    const snap = await this.readManifest(ts);
    if (!snap || !isProtectedCheckpoint(snap)) return undefined;
    const current = await this.listWorkspaceFiles();
    const toDelete = filesToDeleteForExactRestore(current, snap.files);
    const backup = await this.backupBeforeRestore([...snap.files, ...toDelete]);

    let deleted = 0;
    for (const rel of toDelete) {
      if (!backup.files.has(rel)) continue;
      if (await this.deleteWorkspaceFile(rel)) deleted++;
    }

    let restored = 0;
    const skipped: string[] = [];
    for (const rel of snap.files) {
      const src = await this.resolveSnapshotPath(ts, rel);
      if (!src) { skipped.push(rel); continue; }
      if (!(await this.canOverwrite(rel, backup.files))) { skipped.push(rel); continue; }
      if (await this.copyInto(src, rel)) restored++;
      else skipped.push(rel);
    }

    const deletedRels = toDelete.filter(r => backup.files.has(r));
    await this.removeEmptyDirs(deletedRels);
    return { restored, deleted, skipped };
  }

  async deleteSnapshot(ts: string): Promise<boolean> {
    if (!isValidSnapshotName(ts)) return false;
    const root = await this.getSnapshotsRoot();
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
    const snapSet = new Set(snap.files);

    const deleted = snap.files.filter(f => !currentSet.has(f));
    const added = currentFiles.filter(f => !snapSet.has(f));

    const modified: string[] = [];
    const common = snap.files.filter(f => currentSet.has(f));
    for (const rel of common) {
      const snapPath = await this.resolveSnapshotPath(ts, rel);
      if (!snapPath) continue;
      const workspacePath = path.join(this.root, rel);
      try {
        const [snapBuf, curBuf] = await Promise.all([
          fs.readFile(snapPath),
          fs.readFile(workspacePath),
        ]);
        if (!snapBuf.equals(curBuf)) modified.push(rel);
      } catch {
        modified.push(rel);
      }
    }

    return { modified, added, deleted };
  }

  async diff(ts: string, rel: string): Promise<string | undefined> {
    if (!isValidSnapshotName(ts)) return undefined;
    if (typeof rel !== 'string') return undefined;
    const snapPath = await this.resolveSnapshotPath(ts, rel);
    if (!snapPath) return undefined;
    const workspacePath = path.join(this.root, rel);
    if (!isInside(this.root, workspacePath)) return undefined;
    if (!(await isRealPathInside(this.root, workspacePath))) return undefined;

    let snapBuf: Buffer;
    try {
      snapBuf = await fs.readFile(snapPath);
    } catch {
      return undefined;
    }

    let currentBuf: Buffer;
    try {
      currentBuf = await fs.readFile(workspacePath);
    } catch {
      currentBuf = Buffer.alloc(0);
    }

    if (isBinaryBuffer(snapBuf) || isBinaryBuffer(currentBuf)) {
      const same = snapBuf.equals(currentBuf);
      if (same) return '';
      return `Binary file ${rel} differs (snapshot ${ts} vs current).`;
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

    return unifiedDiff(rel, snapContent, currentContent, ts);
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
    const snapRoot = await this.getSnapshotsRoot();
    const metaPath = path.join(snapRoot, ts, 'meta.json');
    try {
      return parseManifest(await fs.readFile(metaPath, 'utf8'));
    } catch {
      return undefined;
    }
  }

  private async backupBeforeRestore(rels: string[]): Promise<{ ts: string | undefined; files: Set<string> }> {
    const { ts, files } = await this.writeSnapshot(rels);
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
    const dest = path.join(this.root, rel);
    if (!isInside(this.root, dest) || !(await isRealPathInside(this.root, dest))) return false;
    try {
      const st = await fs.lstat(dest);
      if (st.isSymbolicLink()) return false;
    } catch {
      // dest does not exist yet
    }
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(src, dest);
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
    for (const dir of emptyDirCandidates(deletedRels)) {
      const target = path.join(this.root, dir);
      if (!isInside(this.root, target) || !(await isRealPathInside(this.root, target))) continue;
      try {
        await fs.rmdir(target);
      } catch {
        // not empty or already gone
      }
    }
  }

  private async pruneOldSnapshots() {
    const root = await this.getSnapshotsRoot();
    try {
      const dirEntries = await fs.readdir(root, { withFileTypes: true });
      const dirs = dirEntries.filter(e => e.isDirectory()).map(e => e.name);
      const entries: SnapshotEntry[] = [];
      for (const d of dirs) {
        const protectedEntry = await this.isCheckpoint(root, d);
        entries.push({ name: d, isCheckpoint: protectedEntry });
      }
      for (const name of selectSnapshotsToPrune(entries, this.maxSnapshots)) {
        await fs.rm(path.join(root, name), { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }

  private async isCheckpoint(root: string, dir: string): Promise<boolean> {
    try {
      const meta = parseManifest(await fs.readFile(path.join(root, dir, 'meta.json'), 'utf8'));
      if (!meta) return true;
      return isProtectedCheckpoint(meta);
    } catch {
      return true;
    }
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

// Detect binary content by checking for null bytes in the first 8KB.
function isBinaryBuffer(buf: Buffer): boolean {
  const check = Math.min(buf.length, 8192);
  for (let i = 0; i < check; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// Unified diff with proper context hunks. Uses a simple O(n*m) LCS to find
// matching lines, then emits standard unified-diff hunks with 3 lines of
// context. Acceptable for the file sizes agents typically snapshot.

const CONTEXT_LINES = 3;

function unifiedDiff(filename: string, oldContent: string, newContent: string, oldLabel: string): string {
  if (oldContent === newContent) return '';

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const edits = myersDiff(oldLines, newLines);
  const hunks = buildHunks(edits, oldLines, newLines);

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

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
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
    } else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) {
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
function buildHunks(edits: Edit[], oldLines: string[], newLines: string[]): string[] {
  // Find runs of changes separated by more than 2*CONTEXT_LINES of keeps.
  const groups: Edit[][] = [];
  let current: Edit[] = [];
  let keepRun = 0;

  for (const e of edits) {
    if (e.type === 'keep') {
      keepRun++;
      if (keepRun > CONTEXT_LINES * 2 && current.length > 0) {
        // Close current group, start fresh
        groups.push(current);
        current = [];
        keepRun = 1;
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
    const oldStart = slice[0].oldIdx + 1;
    const newStart = slice[0].newIdx + 1;
    let oldCount = 0, newCount = 0;
    const lines: string[] = [];
    for (const e of slice) {
      switch (e.type) {
        case 'keep':
          lines.push(` ${oldLines[e.oldIdx]}`);
          oldCount++; newCount++;
          break;
        case 'delete':
          lines.push(`-${oldLines[e.oldIdx]}`);
          oldCount++;
          break;
        case 'insert':
          lines.push(`+${newLines[e.newIdx]}`);
          newCount++;
          break;
      }
    }
    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    output.push(...lines);
  }
  return output;
}
