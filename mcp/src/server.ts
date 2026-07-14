#!/usr/bin/env node
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SnapshotEngine } from './engine.js';

const VERSION = '0.1.0';

interface ParsedArgs {
  root: string;
  excludePatterns?: string[];
  maxFileSizeBytes?: number;
}

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`nogit-mcp ${VERSION}\n`);
      process.exit(0);
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`nogit-mcp ${VERSION}\n\nMCP server for noGIT local snapshots.\n\nUsage: nogit-mcp [options]\n\nOptions:\n  --root <path>           Workspace root (default: cwd)\n  --exclude <pattern>     Glob pattern to exclude (can be repeated)\n  --max-file-size <bytes> Max file size in bytes (default: engine default)\n  --version               Print version and exit\n  --help                  Print this help and exit\n`);
      process.exit(0);
    }
  }
  let root = process.cwd();
  const excludePatterns: string[] = [];
  let maxFileSizeBytes: number | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) { root = args[i + 1]; i++; }
    else if (args[i].startsWith('--root=')) { root = args[i].slice('--root='.length); }
    else if (args[i] === '--exclude' && args[i + 1]) { excludePatterns.push(args[i + 1]); i++; }
    else if (args[i].startsWith('--exclude=')) { excludePatterns.push(args[i].slice('--exclude='.length)); }
    else if (args[i] === '--max-file-size' && args[i + 1]) { maxFileSizeBytes = parseInt(args[i + 1], 10); i++; }
    else if (args[i].startsWith('--max-file-size=')) { maxFileSizeBytes = parseInt(args[i].slice('--max-file-size='.length), 10); }
  }
  return {
    root,
    excludePatterns: excludePatterns.length > 0 ? excludePatterns : undefined,
    maxFileSizeBytes,
  };
}

const parsed = parseArgs();
const root = path.resolve(parsed.root);

// Normalize paths that agents pass: strip absolute prefix (if within root),
// remove leading ./ , convert backslashes, collapse double slashes.
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
  return path.posix.normalize(p);
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

const server = new McpServer({
  name: 'nogit-mcp',
  version: VERSION,
});

server.tool(
  'nogit_status',
  'Show the noGIT workspace status: root path, snapshot count, and most recently created checkpoint. Note: this shows when the checkpoint was taken, not which state the workspace is currently at. Use nogit_diff_summary to compare the workspace against any checkpoint.',
  async () => {
    const snapshots = await engine.listSnapshots();
    const manualCount = snapshots.filter(s => s.label && !s.auto).length;
    const cp = await engine.latestCheckpoint();
    const lines = [`Workspace: ${root}`, `Snapshots: ${snapshots.length} (${manualCount} checkpoints, ${snapshots.length - manualCount} auto)`];
    if (cp) lines.push(`Most recent checkpoint: ${cp.timestamp} [${cp.label}] - ${cp.files.length} files`);
    else lines.push('No checkpoints yet.');
    return { content: [{ type: 'text', text: lines.join('\n') }] };
  },
);

server.tool(
  'nogit_checkpoint',
  'Capture a named checkpoint of the entire workspace. Checkpoints are protected from automatic pruning.',
  { label: z.string().describe('A short label for the checkpoint, e.g. "before refactor"') },
  async ({ label }) => {
    const { ts, fileCount, totalFiles } = await engine.checkpoint(label);
    if (!ts) return { content: [{ type: 'text', text: 'Checkpoint failed: no files captured or empty label.' }] };
    const skipped = totalFiles - fileCount;
    let msg = `Checkpoint "${label}" saved: ${fileCount} files captured (${ts}).`;
    if (skipped > 0) msg += `\nWarning: ${skipped} files skipped (exceed 5 MB size limit). These files are NOT protected by this checkpoint.`;
    return { content: [{ type: 'text', text: msg }] };
  },
);

server.tool(
  'nogit_snapshot_now',
  'Capture a snapshot of all workspace files right now.',
  async () => {
    const { ts, fileCount, totalFiles } = await engine.snapshotNow();
    if (!ts) return { content: [{ type: 'text', text: 'Snapshot failed: no files captured.' }] };
    const skipped = totalFiles - fileCount;
    let msg = `Snapshot saved: ${fileCount} files (${ts}).`;
    if (skipped > 0) msg += `\nWarning: ${skipped} files skipped (exceed 5 MB size limit).`;
    return { content: [{ type: 'text', text: msg }] };
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
      const label = s.label ? ` [${s.label}]` : '';
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
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot. Use nogit_list_snapshots to see available snapshots.` }] };
    const rel = normalizePath(rawRel);
    const result = await engine.restoreFile(ts, rel);
    if (result.skipped) return { content: [{ type: 'text', text: `Restore skipped for ${rel}: current version could not be backed up (file may exceed size limit). Restore was aborted to avoid data loss.` }] };
    if (!result.ok) return { content: [{ type: 'text', text: `Restore failed: ${rel} was not found in snapshot ${ts}. Use nogit_snapshot_files to see what files are available.` }] };
    const undo = result.backupTs ? ` To undo, restore from backup ${result.backupTs}.` : '';
    return { content: [{ type: 'text', text: `Restored ${rel} from snapshot ${ts}.${undo}` }] };
  },
);

server.tool(
  'nogit_restore_snapshot',
  'Restore all files from a snapshot (additive, does not delete files added since). Current state is backed up first.',
  { timestamp: z.string().describe('Snapshot timestamp or checkpoint label') },
  async ({ timestamp }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot. Use nogit_list_snapshots to see available snapshots.` }] };
    const { restored, skipped, backupTs } = await engine.restoreSnapshot(ts);
    if (restored === 0 && skipped.length === 0) return { content: [{ type: 'text', text: `Restore failed: snapshot ${ts} not found or contains no files.` }] };
    const undo = backupTs ? ` To undo, restore from backup ${backupTs}.` : '';
    let msg = `Restored ${restored} files from snapshot ${ts}.${undo}`;
    if (skipped.length > 0) {
      const shown = skipped.slice(0, 10);
      const extra = skipped.length > 10 ? ` and ${skipped.length - 10} more` : '';
      msg += `\nSkipped ${skipped.length} files (could not back up or copy): ${shown.join(', ')}${extra}`;
    }
    return { content: [{ type: 'text', text: msg }] };
  },
);

server.tool(
  'nogit_restore_checkpoint_exact',
  'Restore the workspace to exactly a checkpoint: restores its files AND deletes files added since. This is the "undo everything" button. Only works on manual checkpoints. Current state is backed up first. Omit timestamp to restore the latest checkpoint. Accepts a checkpoint label instead of a timestamp.',
  { timestamp: z.string().optional().describe('Checkpoint timestamp or label (default: latest checkpoint)') },
  async ({ timestamp }) => {
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: resolveTsError(timestamp) }] };
    const result = await engine.restoreCheckpointExact(ts);
    if (!result) return { content: [{ type: 'text', text: `Failed: ${ts} is not a manual checkpoint or does not exist.` }] };
    const undo = result.backupTs ? ` To undo, restore from backup ${result.backupTs}.` : '';
    let msg = `Exact restore complete: ${result.restored} files restored, ${result.deleted} files deleted to match checkpoint ${ts}.${undo}`;
    if (result.skipped.length > 0) {
      const shown = result.skipped.slice(0, 10);
      const extra = result.skipped.length > 10 ? ` and ${result.skipped.length - 10} more` : '';
      msg += `\nSkipped ${result.skipped.length} files (could not back up): ${shown.join(', ')}${extra}`;
    }
    return { content: [{ type: 'text', text: msg }] };
  },
);

server.tool(
  'nogit_latest_checkpoint',
  'Get the most recently created named checkpoint (timestamp and label). This is the newest checkpoint by creation time, not necessarily the current workspace state.',
  async () => {
    const cp = await engine.latestCheckpoint();
    if (!cp) return { content: [{ type: 'text', text: 'No checkpoints found.' }] };
    return { content: [{ type: 'text', text: `Most recent checkpoint: ${cp.timestamp} [${cp.label}] - ${cp.files.length} files` }] };
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
    const diff = await engine.diff(ts, rel);
    if (diff === undefined) return { content: [{ type: 'text', text: `Cannot diff: ${rel} does not exist in snapshot ${ts} or in the current workspace.` }] };
    if (diff === '') return { content: [{ type: 'text', text: `No changes: ${rel} is identical to snapshot ${ts}.` }] };
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
      lines.push(`${label} (${list.length}):\n${shown.map(f => '  ' + prefix + ' ' + f).join('\n')}`);
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
    const ts = await resolveTs(timestamp);
    if (!ts) return { content: [{ type: 'text', text: `Could not resolve "${timestamp}" to a snapshot.` }] };
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
    const shown = files.slice(0, MAX_SHOW);
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
    const content = await engine.readFile(ts, rel);
    if (content === undefined) return { content: [{ type: 'text', text: `File ${rel} not found in snapshot ${ts}, is binary, or path is invalid.` }] };
    return { content: [{ type: 'text', text: content }] };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('nogit-mcp fatal:', err);
  process.exit(1);
});
