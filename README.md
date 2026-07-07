# noGIT: Local History Timeline for VS Code

Automatic local snapshots of your workspace, browsable from a timeline panel. No Git repository required.

noGIT saves copies of the files you edit at a regular interval and lets you open, diff, or restore any earlier version from a timeline view. It is meant for folders where a full Git repo is more than you need: quick scripts, school projects, config files, scratch work. It also works as an undo button for AI coding agents, which often rewrite many files at once and directly on disk.

## Features

- Automatic snapshots of modified files on a configurable interval (default: every 10 minutes)
- Captures changes made outside the editor too, including files written by AI agents and other tools
- Automatic checkpoint when many files change at once, so an AI agent run gets a single labeled restore point
- All data stays in a local `.nogit/` folder inside your workspace
- Timeline panel listing every snapshot and the files it captured
- Status bar item showing when the last snapshot was taken, with one click to the timeline
- Open, diff, or restore any captured version of a file
- Named checkpoints of the whole workspace, kept out of automatic pruning
- Public API so other extensions and agents can snapshot and restore programmatically
- Automatic pruning to cap the number of stored snapshots (default: 48)
- Configurable exclude patterns, with `node_modules`, `.git`, `dist`, and `out` ignored by default
- No network calls and no runtime dependencies

## Install

### From the VS Code Marketplace

Search for "noGIT" in the Extensions view (`Ctrl+Shift+X`), or install from the command line:

```bash
code --install-extension yashanil98.nogit
```

### From a VSIX file

Download the `.vsix` from the [Releases page](https://github.com/yashanil98/noGIT/releases), then:

```bash
code --install-extension nogit-0.4.0.vsix
```

### From source

```bash
git clone https://github.com/yashanil98/noGIT.git
cd noGIT
npm install
npm run build
```

Open the folder in VS Code and press `F5` to launch an Extension Development Host with noGIT loaded.

## Usage

1. Open a folder in VS Code. noGIT activates on startup.
2. Edit and save files. noGIT tracks which files change.
3. Wait for the next automatic snapshot, or trigger one immediately:

   `Ctrl+Shift+P` then `noGIT: Snapshot Now`

4. Open the timeline:

   `Ctrl+Shift+P` then `noGIT: Show Timeline`

5. For any file in the timeline, click `Open` to view that version, `Diff` to compare it against your current file, `Diff prev` to compare it against the previous snapshot of that file, or `Restore` to bring it back. `Restore all files` restores the whole snapshot, and `Delete` removes it.

## Commands

| Command | Description |
| --- | --- |
| `noGIT: Snapshot Now` | Capture the files modified since the last snapshot |
| `noGIT: Show Timeline` | Open the timeline panel |
| `noGIT: Create Checkpoint` | Capture a named checkpoint of the entire workspace |
| `noGIT: Restore Latest Checkpoint` | Roll the workspace back to the most recent checkpoint (additive) |
| `noGIT: Restore Latest Checkpoint (Exact, Deletes Added Files)` | Return the workspace to exactly the checkpoint, deleting files added since |
| `noGIT: Delete Snapshot` | Delete a snapshot from the store |

Restoring a file or snapshot first snapshots your current state, so any restore can itself be undone.

## Using noGIT with AI agents

AI coding agents often rewrite many files at once, sometimes writing directly to disk rather than through the editor. noGIT captures those changes and gives you a one-click way back.

When a burst of files changes together, noGIT records an automatic checkpoint labeled with the file count (for example "auto: 14 files changed"), so an agent run leaves a single clear restore point without you doing anything. These auto checkpoints are still pruned over time; a manual checkpoint is kept until you delete it. Tune the behavior with `nogit.autoCheckpointOnBurst` and `nogit.burstMinFiles`.

You can also create a checkpoint yourself before handing the workspace to an agent (`noGIT: Create Checkpoint`, for example named "before agent run"), then use `Diff` and `Restore` in the timeline to review what the agent changed, or `noGIT: Restore Latest Checkpoint` to roll the whole run back in one step.

Restoring a snapshot re-creates the files it captured with their saved contents. It is additive: it does not delete files the agent added after the snapshot was taken. To undo an agent run completely, including files it created, use `noGIT: Restore Latest Checkpoint (Exact, Deletes Added Files)`, which returns the workspace to exactly a manual checkpoint. It tells you how many files it will delete and snapshots your current files first, so it can be undone.

Other extensions can drive noGIT through its public API:

```ts
import type { NoGitApi } from 'nogit';

const ext = vscode.extensions.getExtension('yashanil98.nogit');
const api: NoGitApi | undefined = ext?.exports;

await api?.checkpoint('before agent run');

// React to snapshots taken in the background.
api?.onDidChangeSnapshots(() => refreshMyView());

// snapshotNow resolves to the new timestamp, or undefined if nothing changed.
const ts = await api?.snapshotNow();

// Roll back to the checkpoint taken before the run.
const cp = await api?.latestCheckpoint();
if (cp) await api?.restoreSnapshot(cp.timestamp);

const snapshots = await api?.listSnapshots();
await api?.deleteSnapshot(snapshots[0].timestamp); // permanent, not reversible
```

The restore and delete methods run without a confirmation prompt, so an integrator that exposes them to an agent owns any confirmation.

## Configuration

Configure noGIT in your VS Code `settings.json`:

```jsonc
{
  // Enable or disable automatic snapshots.
  "nogit.enable": true,

  // Minutes between automatic snapshots.
  "nogit.snapshotIntervalMinutes": 10,

  // Maximum snapshots to keep. Oldest are pruned first.
  "nogit.maxSnapshots": 48,

  // Folder inside the workspace where snapshots are stored.
  "nogit.snapshotFolderName": ".nogit",

  // Show a status bar item with the time since the last snapshot.
  "nogit.showStatusBarItem": true,

  // Skip files larger than this many bytes. Set to 0 for no limit.
  "nogit.maxFileSizeBytes": 5000000,

  // Capture an automatic checkpoint when many files change at once.
  "nogit.autoCheckpointOnBurst": true,

  // Files that must change together to trigger a burst checkpoint.
  "nogit.burstMinFiles": 10,

  // Glob patterns to exclude from snapshots.
  "nogit.excludePatterns": [
    "**/.git/**",
    "**/.nogit/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**"
  ]
}
```

## How it works

```
your-project/
  src/
    app.ts
  .nogit/                       created automatically
    snapshots/
      20260611-143022/          timestamp folder
        src/app.ts              copy of the file at that moment
        meta.json               manifest of captured files
      20260611-153022/
        src/app.ts
        meta.json
```

Each snapshot copies only the files that changed since the previous snapshot. The `meta.json` manifest records which files were captured and when. The `.nogit/` folder is git-ignored automatically, so the local history never shows up in `git status`.

## Development

```bash
npm install            # install dependencies
npm run build          # production bundle
npm run compile        # type-check with tsc
npm test               # run the unit tests
npm run watch:esbuild  # rebuild on save
npm run package        # build a .vsix
```

Press `F5` in VS Code to launch the Extension Development Host.

## Roadmap

- Multi-root workspace support
- Per-file timeline in the editor gutter
- Retention policy for checkpoints

## License

MIT. See [LICENSE](LICENSE).
