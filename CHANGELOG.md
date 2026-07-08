# Changelog

All notable changes to the noGIT extension are documented here.

## [Unreleased]

- Fix snapshot ordering when ten or more snapshots are taken in the same second: the numeric collision suffix is now compared as a number, so pruning no longer deletes the newest snapshots of a burst and diff/restore pick the right version.
- Treat `?` in an exclude pattern as a literal character instead of a wildcard.
- Diff a file against the previous snapshot that captured it, not only against the current file.
- New `noGIT: Restore Latest Checkpoint` command to roll the whole workspace back to the most recent checkpoint in one step.
- New `noGIT: Restore Latest Checkpoint (Exact, Deletes Added Files)` command to return the workspace to exactly a manual checkpoint, deleting files added since. It previews the delete count, confirms, and snapshots the current state first so it can be undone.
- Automatic checkpoint when a burst of files changes together (for example during an AI agent run), labeled with the file count and still subject to pruning. Configurable via `nogit.autoCheckpointOnBurst` and `nogit.burstMinFiles`.
- Public API additions: `onDidChangeSnapshots` event, `snapshotNow` now resolves to the new snapshot timestamp or undefined when nothing changed, and `latestCheckpoint()` (API 1.3.0).

## [0.4.0]

- Delete a snapshot from the timeline, with a confirmation prompt. Also available as the `noGIT: Delete Snapshot` command and through the public API (`deleteSnapshot`, API 1.1.0).
- `noGIT: Snapshot Now` now reports when there are no changes to capture instead of doing nothing.
- New `nogit.showStatusBarItem` setting to hide the status bar item.

## [0.3.0]

Reliability and visibility improvements.

- Fix a case where two snapshots taken in the same second could overwrite each other, which could orphan files or drop a checkpoint label. This was easy to hit through the headless API.
- Git-ignore the `.nogit/` folder automatically so the local history no longer shows up in `git status`.
- Show relative times (for example "5m ago") next to each snapshot in the timeline.
- Add a status bar item showing the time since the last snapshot, with one click to open the timeline.

## [0.2.0]

Adds a safety net for AI coding agents and other tools that edit files in bulk.

- Capture file changes made outside the editor (for example by AI agents writing directly to disk) via a filesystem watcher.
- Restore a single file or an entire snapshot from the timeline. The current state is snapshotted first so a restore can itself be undone.
- Diff any snapshot version against the current file in the native diff editor.
- Named checkpoints of the whole workspace, kept out of automatic pruning.
- Public extension API so other extensions and agents can snapshot, checkpoint, list, and restore programmatically.
- Unit test suite for the exclude-pattern matcher.

## [0.1.0]

Initial release.

- Automatic snapshots of modified files on a configurable interval.
- Timeline panel listing every snapshot and the files it captured.
- Open any captured version of a file in a read-only tab.
- Automatic pruning to cap the number of stored snapshots.
- Configurable exclude patterns with glob support for `*` and `**`.
- `noGIT: Snapshot Now` and `noGIT: Show Timeline` commands.
