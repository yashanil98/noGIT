#!/usr/bin/env node
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SnapshotEngine } from './engine.js';

const VERSION = '0.1.0';

// Auto-prefix bare patterns with **/ so they match at any depth.
// Without this, --exclude .env only excludes the root-level file, and
// --exclude *.pyc only excludes root-level .pyc files -- never what
// the user intends. Patterns that already contain a / or start with
// **/ are left as-is (the user specified a path-aware pattern).
function normalizeExclude(pattern: string): string {
  if (pattern.startsWith('**/') || pattern.includes('/')) return pattern;
  return `**/${pattern}`;
}

interface ParsedArgs {
  root: string;
  excludePatterns?: string[];
  maxFileSizeBytes?: number;
  watch: boolean;
  burstMinFiles: number;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`nogit-mcp ${VERSION}\n`);
      process.exit(0);
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`nogit-mcp ${VERSION}\n\nMCP server for noGIT local snapshots.\n\nUsage: nogit-mcp [options]\n\nOptions:\n  --root <path>           Workspace root (default: cwd)\n  --exclude <pattern>     Glob pattern to exclude (can be repeated)\n  --max-file-size <bytes> Max file size in bytes (default: 5000000)\n  --watch                 Enable file watcher for auto-burst checkpoints\n  --burst-min-files <N>   Minimum changed files to trigger burst (default: 10)\n  --version               Print version and exit\n  --help                  Print this help and exit\n`);
      process.exit(0);
    }
  }
  let root = process.cwd();
  const excludePatterns: string[] = [];
  let maxFileSizeBytes: number | undefined;
  let watch = false;
  let burstMinFiles = 10;
  const hasValue = (i: number) => i + 1 < args.length && !args[i + 1].startsWith('--');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && hasValue(i)) { root = args[i + 1]; i++; }
    else if (args[i].startsWith('--root=')) { root = args[i].slice('--root='.length); }
    else if (args[i] === '--exclude' && hasValue(i)) { excludePatterns.push(normalizeExclude(args[i + 1])); i++; }
    else if (args[i].startsWith('--exclude=')) { excludePatterns.push(normalizeExclude(args[i].slice('--exclude='.length))); }
    else if (args[i] === '--max-file-size' && hasValue(i)) { const n = parseInt(args[i + 1], 10); if (n > 0) maxFileSizeBytes = n; i++; }
    else if (args[i].startsWith('--max-file-size=')) { const n = parseInt(args[i].slice('--max-file-size='.length), 10); if (n > 0) maxFileSizeBytes = n; }
    else if (args[i] === '--watch') { watch = true; }
    else if (args[i] === '--burst-min-files' && hasValue(i)) { const n = parseInt(args[i + 1], 10); if (n >= 1) burstMinFiles = n; i++; }
    else if (args[i].startsWith('--burst-min-files=')) { const n = parseInt(args[i].slice('--burst-min-files='.length), 10); if (n >= 1) burstMinFiles = n; }
  }
  return {
    root,
    excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    maxFileSizeBytes,
    watch,
    burstMinFiles,
  };
}

const parsed = parseArgs();
const root = path.resolve(parsed.root);

// Normalize paths that agents pass: strip absolute prefix (if within root),
// remove leading ./ , convert backslashes, collapse double slashes.
// Returns the empty string for paths that escape the workspace (engine rejects those).
function normalizePath(rel: string): string {
  let p = rel;
  // Convert Windows backslashes to forward slashes first
  p = p.replace(/\\/g, '/');
  if (path.isAbsolute(p)) {
    const resolved = path.resolve(p);
    if (resolved.startsWith(root + path.sep) || resolved === root) {
      p = path.relative(root, resolved);
    }
  }
  // Remove leading ./
  p = p.replace(/^\.\//, '');
  // Normalize path separators and collapse
  p = path.posix.normalize(p);
  // Reject traversals that escape the workspace, and '.' (root directory itself)
  if (p.startsWith('../') || p === '..' || p === '.') return '';
  return p;
}

// Resolve timestamp-or-label: accepts a raw timestamp or a checkpoint label
// (case-insensitive, substring match). Returns the resolved timestamp or undefined.
async function resolveTs(input: string | undefined): Promise<string | undefined> {
  if (!input) return (await engine.latestCheckpoint())?.timestamp;
  const trimmed = input.trim();
  if (!trimmed) return (await engine.latestCheckpoint())?.timestamp;
  return engine.resolveTimestamp(trimmed);
}

function resolveTsError(input: string | undefined): string {
  if (!input || !input.trim()) return 'No checkpoint found. Create one with nogit_checkpoint first.';
  return `Could not resolve "${input.trim()}" to a snapshot. Check the label or timestamp with nogit_list_snapshots.`;
}

import * as fs from 'node:fs';
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  process.stderr.write(`nogit-mcp: error: workspace root does not exist or is not a directory: ${root}\n`);
  process.exit(1);
}

const engine = new SnapshotEngine({
  root,
  excludePatterns: parsed.excludePatterns,
  maxFileSizeBytes: parsed.maxFileSizeBytes,
});

// The effective per-file size cap the engine uses (mirrors its default when
// --max-file-size was not given), so skipped-file warnings can report the
// real limit instead of a hardcoded value.
const DEFAULT_MAX_FILE_SIZE = 5_000_000;
const effectiveMaxFileSize =
  (typeof parsed.maxFileSizeBytes === 'number' && parsed.maxFileSizeBytes > 0)
    ? parsed.maxFileSizeBytes
    : DEFAULT_MAX_FILE_SIZE;

function formatByteLimit(bytes: number): string {
  if (bytes >= 1_000_000 && bytes % 1_000_000 === 0) return `${bytes / 1_000_000} MB`;
  if (bytes >= 1_000 && bytes % 1_000 === 0) return `${bytes / 1_000} KB`;
  return `${bytes} bytes`;
}
const maxFileSizeLabel = formatByteLimit(effectiveMaxFileSize);

// Replace line-breaking control characters so a value stays on one line in
// the line-oriented tool output. Applies to labels and file paths, both of
// which can legally contain newlines/tabs (Unix filenames, arbitrary labels).
function sanitizeForLine(s: string): string {
  return s.replace(/[\n\r\t]/g, ' ');
}

// Truncate a string to at most `max` UTF-16 code units without splitting a
// surrogate pair at the boundary (a lone high surrogate is invalid in JSON).
function safeTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  const lastCode = cut.charCodeAt(cut.length - 1);
  if (lastCode >= 0xD800 && lastCode <= 0xDBFF) cut = cut.slice(0, -1);
  return cut;
}

function errorResult(err: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const msg = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text', text: `Internal error: ${msg}` }] };
}

const server = new McpServer(
  { name: 'nogit-mcp', version: VERSION },
  { instructions: 'noGIT provides local workspace snapshots. Call nogit_checkpoint before risky operations (bulk edits, refactors, migrations). Call nogit_restore_checkpoint_exact to roll back if something goes wrong. Call nogit_undo to reverse a restore. All tools accept checkpoint labels instead of timestamps.' },
);

server.tool(
  'nogit_status',
  'Show the noGIT workspace status: root path, snapshot count, and most recently created checkpoint. Note: this shows when the checkpoint was taken, not which state the workspace is currently at. Use nogit_diff_summary to compare the workspace against any checkpoint.',
  async () => {
    const snapshots = await engine.listSnapshots();
    // Three snapshot kinds exist: protected checkpoints (label set, not auto),
    // auto-burst snapshots (label set, auto:true), and plain snapshots from
    // snapshot_now / pre-restore backups (no label). Report each honestly rather
    // than lumping plain snapshots under "auto" -- which contradicted
    // nogit_list_snapshots, where only auto:true snapshots carry the (auto) tag.
    const manualCount = snapshots.filter(s => s.label && !s.auto).length;
    const autoCount = snapshots.filter(s => s.auto).length;
    const plainCount = snapshots.length - manualCount - autoCount;
    const cp = await engine.latestCheckpoint();
    const lines = [`Workspace: ${root}`, `Snapshots: ${snapshots.length} (${manualCount} checkpoints, ${autoCount} auto, ${plainCount} snapshots)`];
    if (cp) lines.push(`Most recent checkpoint: ${cp.timestamp} [${sanitizeForLine(cp.label!)}] - ${cp.files.length} files`);
    else lines.push('No checkpoints yet.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'nogit_checkpoint',
  'Capture a named checkpoint of the entire workspace. Checkpoints are protected from automatic pruning.',
  { label: z.string().describe('A short label for the checkpoint, e.g. "before refactor"') },
  async ({ label }) => {
    try {
      const { ts, fileCount, totalFiles } = await engine.checkpoint(label);
      if (!ts) return { content: [{ type: 'text', text: 'Checkpoint failed: no files captured or empty label.' }] };
      const skipped = totalFiles - fileCount;
      let msg = `Checkpoint "${sanitizeForLine(label)}" saved: ${fileCount} files captured (${ts}).`;
      if (skipped > 0) msg += `\nWarning: ${skipped} files skipped (exceed ${maxFileSizeLabel} size limit). These files are NOT protected by this checkpoint.`;
      return { content: [{ type: 'text', text: msg }] };
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'nogit_snapshot_now',
  'Capture an unlabeled snapshot of all workspace files. Unlike checkpoints, snapshots are automatically pruned when the store exceeds its retention limit. Use nogit_checkpoint for important save points you want to keep.',
  async () => {
    try {
      const { ts, fileCount, totalFiles } = await engine.snapshotNow();
      if (!ts) return { content: [{ type: 'text', text: 'Snapshot failed: no files captured.' }] };
      const skipped = totalFiles - fileCount;
      let msg = `Snapshot saved: ${fileCount} files (${ts}).`;
      if (skipped > 0) msg += `\nWarning: ${skipped} files skipped (exceed ${maxFileSizeLabel} size limit).`;
      return { content: [{ type: 'text', text: msg }] };
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'nogit_list_snapshots',
  'List all snapshots and checkpoints, newest first. Returns timestamp, label, and file count. Shows up to 50 most recent.',
  async () => {
    const snapshots = await engine.listSnapshots();
    if (snapshots.length === 0) {
      return { content: [{ type: 'text', text: 'No snapshots found.' }] };
    }
    const MAX_SHOW = 50;
    const shown = snapshots.slice(0, MAX_SHOW);
    const lines = shown.map(s => {
      const label = s.label ? ` [${sanitizeForLine(s.label)}]` : '';
      const auto = s.auto ? ' (auto)' : '';
      return `${s.timestamp}${label}${auto} - ${s.files.length} files`;
    });
    if (snapshots.length > MAX_SHOW) lines.push(`... and ${snapshots.length - MAX_SHOW} older snapshots`);
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'nogit_restore_file',
  'Restore a single file from a snapshot. The current version is backed up first.',
  {
    timestamp: z.string().describe('Snapshot timestamp or checkpoint label'),
    path: z.string().describe('Workspace-relative file path to restore'),
  },
  async ({ timestamp, path: rawRel }) => {
    try {
      const ts = await resolveTs(timestamp);
      if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot. Use nogit_list_snapshots to see available snapshots.` }] };
      const rel = normalizePath(rawRel);
      if (!rel) return { content: [{ type: 'text', text: `Invalid path: "${sanitizeForLine(rawRel)}" escapes the workspace root.` }] };
      const relDisp = sanitizeForLine(rel);
      const result = await engine.restoreFile(ts, rel);
      if (result.skipped) return { content: [{ type: 'text', text: `Restore skipped for ${relDisp}: could not safely replace the current file. This usually means the current version could not be backed up (may exceed the size limit) or the destination path is blocked (e.g. by a non-directory). No changes were made.` }] };
      if (!result.ok) return { content: [{ type: 'text', text: `Restore failed: ${relDisp} was not found in snapshot ${ts}. Use nogit_snapshot_files to see what files are available.` }] };
      const undo = result.backupTs ? ` To undo, restore from backup ${result.backupTs}.` : '';
      return { content: [{ type: 'text', text: `Restored ${relDisp} from snapshot ${ts}.${undo}` }] };
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'nogit_restore_snapshot',
  'Restore all files from a snapshot (additive, does not delete files added since). Current state is backed up first.',
  { timestamp: z.string().describe('Snapshot timestamp or checkpoint label') },
  async ({ timestamp }) => {
    try {
      const ts = await resolveTs(timestamp);
      if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot. Use nogit_list_snapshots to see available snapshots.` }] };
      const { restored, skipped, backupTs } = await engine.restoreSnapshot(ts);
      if (restored === 0 && skipped.length === 0) return { content: [{ type: 'text', text: `Restore failed: snapshot ${ts} not found or contains no files.` }] };
      const undo = (restored > 0 && backupTs) ? ` To undo, restore from backup ${backupTs}.` : '';
      let msg = `Restored ${restored} files from snapshot ${ts}.${undo}`;
      if (skipped.length > 0) {
        const shown = skipped.slice(0, 10).map(sanitizeForLine);
        const extra = skipped.length > 10 ? ` and ${skipped.length - 10} more` : '';
        msg += `\nSkipped ${skipped.length} files (could not back up or copy): ${shown.join(', ')}${extra}`;
      }
      return { content: [{ type: 'text', text: msg }] };
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'nogit_restore_checkpoint_exact',
  'Restore the workspace to exactly a checkpoint: restores its files AND deletes files added since. This is the "undo everything" button. Only works on manual checkpoints. Current state is backed up first. Omit timestamp to restore the latest checkpoint. Accepts a checkpoint label instead of a timestamp.',
  { timestamp: z.string().optional().describe('Checkpoint timestamp or label (default: latest checkpoint)') },
  async ({ timestamp }) => {
    try {
      const ts = await resolveTs(timestamp);
      if (!ts) return { content: [{ type: 'text', text: resolveTsError(timestamp) }] };
      const result = await engine.restoreCheckpointExact(ts);
      if (!result) return { content: [{ type: 'text', text: `Failed: ${ts} is not a manual checkpoint or does not exist.` }] };
      const undo = ((result.restored > 0 || result.deleted > 0) && result.backupTs) ? ` To undo, restore from backup ${result.backupTs}.` : '';
      let msg = `Exact restore complete: ${result.restored} files restored, ${result.deleted} files deleted to match checkpoint ${ts}.${undo}`;
      if (result.skipped.length > 0) {
        const shown = result.skipped.slice(0, 10).map(sanitizeForLine);
        const extra = result.skipped.length > 10 ? ` and ${result.skipped.length - 10} more` : '';
        msg += `\nSkipped ${result.skipped.length} files (could not back up): ${shown.join(', ')}${extra}`;
      }
      return { content: [{ type: 'text', text: msg }] };
    } catch (err) { return errorResult(err); }
  },
);

server.tool(
  'nogit_latest_checkpoint',
  'Get the most recently created named checkpoint (timestamp and label). This is the newest checkpoint by creation time, not necessarily the current workspace state.',
  async () => {
    const cp = await engine.latestCheckpoint();
    if (!cp) return { content: [{ type: 'text', text: 'No checkpoints found.' }] };
    return { content: [{ type: 'text', text: `Most recent checkpoint: ${cp.timestamp} [${sanitizeForLine(cp.label!)}] - ${cp.files.length} files` }] };
  },
);

server.tool(
  'nogit_diff',
  'Show a unified diff between a file in a snapshot and the current workspace version. Works for modified files, deleted files (shows removal), and new files added since the snapshot (shows addition). Omit timestamp to diff against the latest checkpoint. Accepts a checkpoint label instead of a timestamp.',
  {
    timestamp: z.string().optional().describe('Snapshot timestamp or checkpoint label (default: latest checkpoint)'),
    path: z.string().describe('Workspace-relative file path to diff'),
  },
  async ({ timestamp, path: rawRel }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: resolveTsError(timestamp) }] };
    const rel = normalizePath(rawRel);
    if (!rel) return { content: [{ type: 'text', text: `Invalid path: "${sanitizeForLine(rawRel)}" escapes the workspace root.` }] };
    const relDisp = sanitizeForLine(rel);
    const diff = await engine.diff(ts, rel);
    if (diff === undefined) return { content: [{ type: 'text', text: `Cannot diff: ${relDisp} does not exist in snapshot ${ts} or in the current workspace.` }] };
    if (diff === '') return { content: [{ type: 'text', text: `No changes: ${relDisp} is identical to snapshot ${ts}.` }] };
    const MAX_DIFF_CHARS = 60_000;
    if (diff.length > MAX_DIFF_CHARS) {
      const truncated = safeTruncate(diff, MAX_DIFF_CHARS);
      const shownLines = truncated.split('\n').length;
      const totalLines = diff.split('\n').length;
      return { content: [{ type: 'text', text: `${truncated}\n\n--- Diff truncated: showing ${shownLines} of ${totalLines} lines. The file has extensive changes; use nogit_read_file to view full versions or nogit_diff_summary for an overview.` }] };
    }
    return { content: [{ type: 'text', text: diff }] };
  },
);

server.tool(
  'nogit_diff_summary',
  'Summary of all changes between a snapshot and the current workspace: which files were modified, added, or deleted since the snapshot. Omit timestamp to compare against the latest checkpoint. Accepts a checkpoint label instead of a timestamp.',
  { timestamp: z.string().optional().describe('Snapshot timestamp or checkpoint label (default: latest checkpoint)') },
  async ({ timestamp }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: resolveTsError(timestamp) }] };
    const summary = await engine.diffSummary(ts);
    if (!summary) return { content: [{ type: 'text', text: `Snapshot ${ts} not found or invalid.` }] };
    const MAX_PER_CATEGORY = 100;
    const lines: string[] = [];
    const fmt = (list: string[], prefix: string, label: string) => {
      if (list.length === 0) return;
      const shown = list.slice(0, MAX_PER_CATEGORY);
      lines.push(`${label} (${list.length}):\n${shown.map(f => '  ' + prefix + ' ' + sanitizeForLine(f)).join('\n')}`);
      if (list.length > MAX_PER_CATEGORY) lines.push(`  ... and ${list.length - MAX_PER_CATEGORY} more`);
    };
    fmt(summary.modified, 'M', 'Modified');
    fmt(summary.added, 'A', 'Added since snapshot');
    fmt(summary.deleted, 'D', 'Deleted since snapshot');
    if (lines.length === 0) lines.push('No changes since this snapshot.');
    return { content: [{ type: 'text', text: lines.join('\n\n') }] };
  },
);

server.tool(
  'nogit_delete_snapshot',
  'Permanently delete a snapshot or checkpoint from the store. This is irreversible. Accepts a checkpoint label instead of a timestamp.',
  { timestamp: z.string().describe('Snapshot timestamp or checkpoint label to delete') },
  async ({ timestamp }) => {
    const trimmed = timestamp.trim();
    if (!trimmed) return { content: [{ type: 'text', text: 'Delete requires an explicit timestamp or label. Use nogit_list_snapshots to find the one you want to remove.' }] };
    const ts = await engine.resolveTimestamp(trimmed);
    if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${trimmed}" to a snapshot. Use nogit_list_snapshots to check available snapshots.` }] };
    const ok = await engine.deleteSnapshot(ts);
    if (!ok) return { content: [{ type: 'text', text: `Delete failed: ${ts} not found or invalid.` }] };
    return { content: [{ type: 'text', text: `Deleted snapshot ${ts}.` }] };
  },
);

server.tool(
  'nogit_snapshot_files',
  'List the files captured in a specific snapshot. Shows first 200 files; use the count to know if truncated. Accepts a checkpoint label instead of a timestamp.',
  { timestamp: z.string().describe('Snapshot timestamp or checkpoint label') },
  async ({ timestamp }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot.` }] };
    const files = await engine.getSnapshotFiles(ts);
    if (!files) return { content: [{ type: 'text', text: `Snapshot ${ts} not found or invalid.` }] };
    if (files.length === 0) return { content: [{ type: 'text', text: `Snapshot ${ts} contains no files.` }] };
    const MAX_SHOW = 200;
    const shown = files.slice(0, MAX_SHOW).map(sanitizeForLine);
    let text = `${files.length} files in ${ts}:\n${shown.join('\n')}`;
    if (files.length > MAX_SHOW) text += `\n... and ${files.length - MAX_SHOW} more (truncated)`;
    return { content: [{ type: 'text', text }] };
  },
);

server.tool(
  'nogit_read_file',
  'Read the content of a file from a snapshot without restoring it. Use this to view old versions, recover deleted functions, or compare logic without modifying the workspace. Returns the raw file content as it existed at that snapshot.',
  {
    timestamp: z.string().optional().describe('Snapshot timestamp or checkpoint label (default: latest checkpoint)'),
    path: z.string().describe('Workspace-relative file path to read from the snapshot'),
  },
  async ({ timestamp, path: rawRel }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: resolveTsError(timestamp) }] };
    const rel = normalizePath(rawRel);
    if (!rel) return { content: [{ type: 'text', text: `Invalid path: "${sanitizeForLine(rawRel)}" escapes the workspace root.` }] };
    const content = await engine.readFile(ts, rel);
    if (content === undefined) return { content: [{ type: 'text', text: `File ${sanitizeForLine(rel)} not found in snapshot ${ts}, is binary, or path is invalid.` }] };
    const MAX_READ_CHARS = 100_000;
    if (content.length > MAX_READ_CHARS) {
      const truncated = safeTruncate(content, MAX_READ_CHARS);
      const totalLines = content.split('\n').length;
      const shownLines = truncated.split('\n').length;
      const byteSize = Buffer.byteLength(content, 'utf8');
      return { content: [{ type: 'text', text: `${truncated}\n\n--- Truncated: showing ${shownLines} of ${totalLines} lines (${byteSize} bytes total). Use nogit_restore_file to get the full file on disk.` }] };
    }
    return { content: [{ type: 'text', text: content }] };
  },
);

server.tool(
  'nogit_undo',
  'Undo the last restore operation by restoring from the automatic backup.',
  async () => {
    try {
      const result = await engine.undo();
      if (!result) return { content: [{ type: 'text', text: 'Nothing to undo.' }] };
      let msg = `Undo complete: ${result.restored} files restored from backup.`;
      if (result.skipped.length > 0) {
        const shown = result.skipped.slice(0, 10).map(sanitizeForLine);
        const extra = result.skipped.length > 10 ? ` and ${result.skipped.length - 10} more` : '';
        msg += `\nSkipped ${result.skipped.length} files: ${shown.join(', ')}${extra}`;
      }
      return { content: [{ type: 'text', text: msg }] };
    } catch (err) { return errorResult(err); }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (parsed.watch) {
    engine.startWatching({ burstMinFiles: parsed.burstMinFiles });
  }
}

main().catch(err => {
  console.error('nogit-mcp fatal:', err);
  process.exit(1);
});
