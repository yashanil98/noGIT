# noGit — Local History Timeline (MVP)

A lightweight, local-first version history extension for small projects. Think Google Docs' version history for VS Code — without Git.

## ✨ Features (MVP)

- ✅ **Autosnapshots** of only **modified files** at a user-set interval.
- ✅ **Local storage** in `.nogit/snapshots/<timestamp>/...` inside your workspace.
- ✅ **Minimal timeline UI** (Webview) to browse snapshots and **open** old versions in a preview tab.
- ✅ **Settings** for `interval` and `maxSnapshots`.
- ✅ **Small projects** focus; simple and safe.

## ⚙️ Settings

Open your VS Code `settings.json` and adjust:

```jsonc
{
  "nogit.enable": true,
  "nogit.snapshotIntervalMinutes": 10,
  "nogit.maxSnapshots": 48,
  "nogit.snapshotFolderName": ".nogit",
  "nogit.excludePatterns": ["**/.git/**", "**/.nogit/**", "**/node_modules/**", "**/dist/**", "**/out/**"]
}
```

## ▶️ Running the Extension (Dev)

1. `npm install`
2. Hit **F5** (or run the **Run Extension** launch config).  
   This opens a new VS Code window with the extension loaded.
3. Make some edits, then either wait for autosnapshot or run **Command Palette → noGit: Snapshot Now**.
4. Open **Command Palette → noGit: Show Timeline** to browse snapshots and open any file preview.

## 📁 Snapshot Layout

```
<your-workspace>/.nogit/snapshots/20251030-182030/<relative-file-path>
<your-workspace>/.nogit/snapshots/20251030-182030/meta.json
```

`meta.json` lists the files captured in that snapshot.

## 🔒 Notes

- Files are opened from the `.nogit/snapshots/...` folder in **preview** mode. Editing them won’t touch your original — it just edits the copy.
- For MVP, we skip complex glob/exclude handling and diff UI. That can be added next.

## 🛣️ Next Up (Post-MVP Ideas)

- Diff view (compare snapshot vs current).
- Better excludes (full glob/micromatch).
- Multi-root workspace support.
- Per-file mini timeline.
- Restore-to-current-file command.

---

Built as a simple foundation you can iterate on quickly.
