#!/usr/bin/env node
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SnapshotEngine } from './engine.js';

const VERSION = '0.1.0';

function resolveRoot(): string {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--version' || arg === '-v') {
      process.stdout.write(`nogit-mcp ${VERSION}\n`);
      process.exit(0);
    }
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`nogit-mcp ${VERSION}\n\nMCP server for noGIT local snapshots.\n\nUsage: nogit-mcp [--root <path>]\n\nOptions:\n  --root <path>  Workspace root (default: cwd)\n  --version      Print version and exit\n  --help         Print this help and exit\n`);
      process.exit(0);
    }
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--root=')) return args[i].slice('--root='.length);
  }
  return process.cwd();
}

const root = path.resolve(resolveRoot());

import * as fs from 'node:fs';
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  process.stderr.write(`nogit-mcp: error: workspace root does not exist or is not a directory: ${root}\n`);
  process.exit(1);
}

const engine = new SnapshotEngine({ root });

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
    const { ts, fileCount } = await engine.checkpoint(label);
    if (!ts) return { content: [{ type: 'text', text: 'Checkpoint failed: no files captured or empty label.' }] };
    return { content: [{ type: 'text', text: `Checkpoint "${label}" saved: ${fileCount} files captured (${ts}).` }] };
  },
);

server.tool(
  'nogit_snapshot_now',
  'Capture a snapshot of all workspace files right now.',
  async () => {
    const { ts, fileCount } = await engine.snapshotNow();
    if (!ts) return { content: [{ type: 'text', text: 'Snapshot failed: no files captured.' }] };
    return { content: [{ type: 'text', text: `Snapshot saved: ${fileCount} files (${ts}).` }] };
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
    timestamp: z.string().describe('Snapshot timestamp (from nogit_list_snapshots)'),
    path: z.string().describe('Workspace-relative file path to restore'),
  },
  async ({ timestamp, path: rel }) => {
    const result = await engine.restoreFile(timestamp, rel);
    if (result.skipped) return { content: [{ type: 'text', text: `Restore skipped for ${rel}: current version could not be backed up (file may exceed size limit). Restore was aborted to avoid data loss.` }] };
    if (!result.ok) return { content: [{ type: 'text', text: `Restore failed: ${rel} was not found in snapshot ${timestamp}. Use nogit_snapshot_files to see what files are available.` }] };
    return { content: [{ type: 'text', text: `Restored ${rel} from snapshot ${timestamp}. Current version was backed up.` }] };
  },
);

server.tool(
  'nogit_restore_snapshot',
  'Restore all files from a snapshot (additive, does not delete files added since). Current state is backed up first.',
  { timestamp: z.string().describe('Snapshot timestamp to restore') },
  async ({ timestamp }) => {
    const { restored, skipped } = await engine.restoreSnapshot(timestamp);
    if (restored === 0 && skipped.length === 0) return { content: [{ type: 'text', text: `Restore failed: snapshot ${timestamp} not found or contains no files.` }] };
    let msg = `Restored ${restored} files from snapshot ${timestamp}. Current state was backed up.`;
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
  'Restore the workspace to exactly a checkpoint: restores its files AND deletes files added since. Only works on manual checkpoints. Current state is backed up first.',
  { timestamp: z.string().describe('Checkpoint timestamp to restore exactly') },
  async ({ timestamp }) => {
    const result = await engine.restoreCheckpointExact(timestamp);
    if (!result) return { content: [{ type: 'text', text: `Failed: ${timestamp} is not a manual checkpoint or does not exist.` }] };
    let msg = `Exact restore complete: ${result.restored} files restored, ${result.deleted} files deleted to match checkpoint ${timestamp}. Current state was backed up.`;
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
  'Show a unified diff between a file in a snapshot and the current workspace version.',
  {
    timestamp: z.string().describe('Snapshot timestamp'),
    path: z.string().describe('Workspace-relative file path to diff'),
  },
  async ({ timestamp, path: rel }) => {
    const diff = await engine.diff(timestamp, rel);
    if (diff === undefined) return { content: [{ type: 'text', text: `Cannot diff: file not found in snapshot ${timestamp} or path invalid.` }] };
    if (diff === '') return { content: [{ type: 'text', text: `No changes: ${rel} is identical to snapshot ${timestamp}.` }] };
    return { content: [{ type: 'text', text: diff }] };
  },
);

server.tool(
  'nogit_diff_summary',
  'Summary of all changes between a snapshot and the current workspace: which files were modified, added, or deleted since the snapshot.',
  { timestamp: z.string().describe('Snapshot timestamp to compare against') },
  async ({ timestamp }) => {
    const summary = await engine.diffSummary(timestamp);
    if (!summary) return { content: [{ type: 'text', text: `Snapshot ${timestamp} not found or invalid.` }] };
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
  'Permanently delete a snapshot or checkpoint from the store. This is irreversible.',
  { timestamp: z.string().describe('Snapshot timestamp to delete') },
  async ({ timestamp }) => {
    const ok = await engine.deleteSnapshot(timestamp);
    if (!ok) return { content: [{ type: 'text', text: `Delete failed: ${timestamp} not found or invalid.` }] };
    return { content: [{ type: 'text', text: `Deleted snapshot ${timestamp}.` }] };
  },
);

server.tool(
  'nogit_snapshot_files',
  'List the files captured in a specific snapshot. Shows first 200 files; use the count to know if truncated.',
  { timestamp: z.string().describe('Snapshot timestamp to inspect') },
  async ({ timestamp }) => {
    const files = await engine.getSnapshotFiles(timestamp);
    if (!files) return { content: [{ type: 'text', text: `Snapshot ${timestamp} not found or invalid.` }] };
    if (files.length === 0) return { content: [{ type: 'text', text: `Snapshot ${timestamp} contains no files.` }] };
    const MAX_SHOW = 200;
    const shown = files.slice(0, MAX_SHOW);
    let text = `${files.length} files in ${timestamp}:\n${shown.join('\n')}`;
    if (files.length > MAX_SHOW) text += `\n... and ${files.length - MAX_SHOW} more (truncated)`;
    return { content: [{ type: 'text', text }] };
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
