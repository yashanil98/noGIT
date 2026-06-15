# noGIT: Local History Timeline for VS Code

Automatic local snapshots of your workspace, browsable from a timeline panel. No Git repository required.

noGIT saves copies of the files you edit at a regular interval and lets you open any earlier version from a timeline view. It is meant for folders where a full Git repo is more than you need: quick scripts, school projects, config files, scratch work.

## Features

- Automatic snapshots of modified files on a configurable interval (default: every 10 minutes)
- All data stays in a local `.nogit/` folder inside your workspace
- Timeline panel listing every snapshot and the files it captured
- Open any captured version of a file in a read-only tab
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
code --install-extension nogit-0.1.0.vsix
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

5. Click `Open` next to any file to view that version in a read-only tab.

## Commands

| Command | Description |
| --- | --- |
| `noGIT: Snapshot Now` | Capture the files modified since the last snapshot |
| `noGIT: Show Timeline` | Open the timeline panel |

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

Each snapshot copies only the files that changed since the previous snapshot. The `meta.json` manifest records which files were captured and when. Add `.nogit/` to your `.gitignore` if the folder is inside a Git repository.

## Development

```bash
npm install            # install dependencies
npm run build          # production bundle
npm run compile        # type-check with tsc
npm run watch:esbuild  # rebuild on save
npm run package        # build a .vsix
```

Press `F5` in VS Code to launch the Extension Development Host.

## Roadmap

- Diff view to compare a snapshot against the current file
- Restore command to revert a file to a previous snapshot
- Multi-root workspace support
- Per-file timeline in the editor gutter

## License

MIT. See [LICENSE](LICENSE).
