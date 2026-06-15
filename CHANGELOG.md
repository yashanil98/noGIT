# Changelog

All notable changes to the noGIT extension are documented here.

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
