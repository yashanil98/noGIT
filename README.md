# 📸 noGIT — Local History Timeline for VS Code

> **Google Docs-style version history for your code. No Git required.**

Ever lose work because you forgot to commit? Ever want undo history that survives closing a file? **noGIT** silently snapshots your workspace at regular intervals, giving you a time-travel timeline right inside VS Code — zero config, zero repos, zero ceremony.

Perfect for quick scripts, school projects, config files, or any folder where spinning up a Git repo feels like overkill.

---

## ✨ Features

- 🕐 **Auto-snapshots** — Captures modified files every N minutes (default: 10)
- 📂 **Local-only storage** — Everything stays in a `.nogit/` folder inside your workspace
- 🗂️ **Timeline UI** — Browse your snapshot history in a clean webview panel
- 👁️ **One-click preview** — Open any previous version of a file in a read-only tab
- 🧹 **Auto-pruning** — Keeps your disk clean by capping stored snapshots (default: 48)
- ⚡ **Lightweight** — No background processes, no network calls, no dependencies
- 🎯 **Smart filtering** — Ignores `node_modules`, `.git`, `dist`, and other noise automatically

---

## 🚀 Quick Start

### Install from source (dev mode)

```bash
git clone https://github.com/yashanil98/noGIT.git
cd noGIT
npm install
npm run build
```

Then open the folder in VS Code and press **F5** to launch with the extension loaded.

### Usage

1. Open any folder in VS Code — noGIT activates automatically
2. Edit some files — noGIT tracks what changes
3. Wait for the auto-snapshot interval, or trigger one manually:

   **`Ctrl+Shift+P` → `noGIT: Snapshot Now`**

4. Browse your history:

   **`Ctrl+Shift+P` → `noGIT: Show Timeline`**

5. Click **Open** on any file in the timeline to preview that version

---

## ⚙️ Configuration

Add these to your VS Code `settings.json`:

```jsonc
{
  "nogit.enable": true,                    // Toggle auto-snapshots on/off
  "nogit.snapshotIntervalMinutes": 10,     // Minutes between snapshots
  "nogit.maxSnapshots": 48,                // Max snapshots before pruning oldest
  "nogit.snapshotFolderName": ".nogit",    // Where snapshots live in your workspace
  "nogit.excludePatterns": [               // Glob patterns to ignore
    "**/.git/**",
    "**/.nogit/**",
    "**/node_modules/**",
    "**/dist/**",
    "**/out/**"
  ]
}
```

---

## 📁 How It Works

```
your-project/
├── src/
│   └── app.ts
├── .nogit/                          ← created automatically
│   └── snapshots/
│       ├── 20260611-143022/         ← timestamp folder
│       │   ├── src/app.ts           ← copy of file at that moment
│       │   └── meta.json            ← manifest of captured files
│       └── 20260611-153022/
│           ├── src/app.ts
│           └── meta.json
└── ...
```

Each snapshot is a flat copy of only the files that changed since the last snapshot. The `meta.json` manifest records what was captured and when.

---

## 🛠️ Development

```bash
npm install          # Install dependencies
npm run build        # One-shot production bundle
npm run compile      # Type-check with tsc
npm run watch:esbuild  # Watch mode (auto-rebuild on save)
```

Press **F5** in VS Code to launch the Extension Development Host with noGIT loaded.

---

## 🗺️ Roadmap

- [ ] Diff view — compare any snapshot against your current file
- [ ] Restore command — revert a file to a previous snapshot
- [ ] Full glob/micromatch pattern support for excludes
- [ ] Multi-root workspace support
- [ ] Per-file mini timeline in the editor gutter
- [ ] Marketplace publishing

---

## 📜 License

MIT — do whatever you want with it.

---

<p align="center">
  <i>Built for people who code faster than they commit.</i>
</p>
