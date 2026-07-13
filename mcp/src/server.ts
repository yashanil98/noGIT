#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SnapshotEngine } from './engine.js';

function resolveRoot(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) return args[i + 1];
    if (args[i].startsWith('--root=')) return args[i].slice('--root='.length);
  }
  return process.cwd();
}

const root = resolveRoot();
const engine = new SnapshotEngine({ root });

const server = new McpServer({
  name: 'nogit-mcp',
  version: '0.1.0',
});

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
  'List all snapshots and checkpoints, newest first. Returns timestamp, label, and file count.',
  async () => {
    const snapshots = await engine.listSnapshots();
    if (snapshots.length === 0) {
      return { content: [{ type: 'text', text: 'No snapshots found.' }] };
    }
    const lines = snapshots.map(s => {
      const label = s.label ? ` [${s.label}]` : '';
      const auto = s.auto ? ' (auto)' : '';
      return `${s.timestamp}${label}${auto} - ${s.files.length} files`;
    });
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
    const ok = await engine.restoreFile(timestamp, rel);
    if (!ok) return { content: [{ type: 'text', text: `Restore failed for ${rel} from ${timestamp}.` }] };
    return { content: [{ type: 'text', text: `Restored ${rel} from snapshot ${timestamp}. Current version was backed up.` }] };
  },
);

server.tool(
  'nogit_restore_snapshot',
  'Restore all files from a snapshot (additive, does not delete files added since). Current state is backed up first.',
  { timestamp: z.string().describe('Snapshot timestamp to restore') },
  async ({ timestamp }) => {
    const count = await engine.restoreSnapshot(timestamp);
    if (count === 0) return { content: [{ type: 'text', text: `Restore failed or no files restored from ${timestamp}.` }] };
    return { content: [{ type: 'text', text: `Restored ${count} files from snapshot ${timestamp}. Current state was backed up.` }] };
  },
);

server.tool(
  'nogit_restore_checkpoint_exact',
  'Restore the workspace to exactly a checkpoint: restores its files AND deletes files added since. Only works on manual checkpoints. Current state is backed up first.',
  { timestamp: z.string().describe('Checkpoint timestamp to restore exactly') },
  async ({ timestamp }) => {
    const count = await engine.restoreCheckpointExact(timestamp);
    if (count === undefined) return { content: [{ type: 'text', text: `Failed: ${timestamp} is not a manual checkpoint or does not exist.` }] };
    return { content: [{ type: 'text', text: `Exact restore complete: ${count} files restored to checkpoint ${timestamp}. Added files were deleted. Current state was backed up.` }] };
  },
);

server.tool(
  'nogit_latest_checkpoint',
  'Get the most recent named checkpoint (timestamp and label).',
  async () => {
    const cp = await engine.latestCheckpoint();
    if (!cp) return { content: [{ type: 'text', text: 'No checkpoints found.' }] };
    return { content: [{ type: 'text', text: `Latest checkpoint: ${cp.timestamp} [${cp.label}] - ${cp.files.length} files` }] };
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('nogit-mcp fatal:', err);
  process.exit(1);
});
