# noGIT

Local snapshots for any workspace. No Git required. Works as an undo button for AI coding agents.

## What it does

noGIT copies files you change into a `.nogit/` folder at a regular interval. You can open, diff, or restore any version from a timeline panel. Named checkpoints capture the full workspace and survive automatic pruning.

When many files change at once (like during an AI agent run), noGIT auto-captures a labeled checkpoint so you always have a clean rollback point.

## Install

```bash
code --install-extension yashanil98.nogit
```

Or from source:

```bash
git clone https://github.com/yashanil98/noGIT.git
cd noGIT && npm install && npm run build
```

## MCP server (for AI agents without VS Code)

noGIT ships an MCP server so terminal agents (Claude Code, etc.) can checkpoint and restore without VS Code running. Same `.nogit/` store format -- snapshots from the server show up in the VS Code timeline and vice versa.

### Setup

```bash
# Build
cd mcp && npm install && npm run build

# Register with Claude Code
claude mcp add nogit-mcp -- node /path/to/noGIT/mcp/dist/src/server.js
```

Or add to `.mcp.json` in your project:

```json
{
  "mcpServers": {
    "nogit": {
      "command": "node",
      "args": ["/path/to/noGIT/mcp/dist/src/server.js", "--root", "."]
    }
  }
}
```

### Tools

| Tool | What it does |
| --- | --- |
| `nogit_status` | Show workspace root, snapshot count, and latest checkpoint |
| `nogit_checkpoint` | Snapshot the entire workspace with a label (protected from pruning) |
| `nogit_snapshot_now` | Snapshot all workspace files right now |
| `nogit_list_snapshots` | List snapshots newest-first (timestamp, label, file count) |
| `nogit_snapshot_files` | List the files inside a specific snapshot |
| `nogit_diff` | Unified diff between a snapshot version and the current file |
| `nogit_diff_summary` | Summary of all modified/added/deleted files since a snapshot |
| `nogit_restore_file` | Restore one file from a snapshot |
| `nogit_restore_snapshot` | Restore all files from a snapshot (additive, keeps new files) |
| `nogit_restore_checkpoint_exact` | Hard restore: match checkpoint exactly, delete files added since |
| `nogit_latest_checkpoint` | Get the most recent named checkpoint |
| `nogit_delete_snapshot` | Permanently delete a snapshot (irreversible) |

Every restore backs up current state first, so restores are reversible.

### Typical agent workflow

```
1. nogit_checkpoint("before refactor")
2. ... agent does work ...
3. nogit_diff(ts, "src/app.ts")         -- review what changed
4. nogit_restore_checkpoint_exact(ts)   -- undo everything if needed
```

## VS Code usage

Open a folder. noGIT activates automatically.

**Commands** (Ctrl+Shift+P):
- `noGIT: Snapshot Now` -- capture modified files
- `noGIT: Show Timeline` -- browse all snapshots
- `noGIT: Create Checkpoint` -- named full-workspace snapshot
- `noGIT: Restore Latest Checkpoint` -- roll back to most recent checkpoint
- `noGIT: Restore Latest Checkpoint (Exact)` -- hard rollback, deletes added files

### Extension API

Other extensions can drive noGIT programmatically:

```ts
const ext = vscode.extensions.getExtension('yashanil98.nogit');
const api = ext?.exports;

await api?.checkpoint('before agent run');
const cp = await api?.latestCheckpoint();
if (cp) await api?.restoreSnapshot(cp.timestamp);
```

## Configuration

```jsonc
{
  "nogit.enable": true,
  "nogit.snapshotIntervalMinutes": 10,
  "nogit.maxSnapshots": 48,
  "nogit.maxFileSizeBytes": 5000000,
  "nogit.autoCheckpointOnBurst": true,
  "nogit.burstMinFiles": 10,
  "nogit.excludePatterns": [
    "**/.git/**", "**/.nogit/**", "**/node_modules/**", "**/dist/**", "**/out/**"
  ]
}
```

## Store format

```
your-project/
  .nogit/
    snapshots/
      20260611-143022/
        src/app.ts        -- file copy
        meta.json         -- { timestamp, files, label? }
```

The `.nogit/` folder is auto-gitignored.

## Development

```bash
npm install && npm run build    # extension
npm test                        # 128 unit tests
cd mcp && npm install && npm run build && npm test   # MCP server (19 tests)
```

## License

MIT
