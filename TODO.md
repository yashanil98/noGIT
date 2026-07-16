# TODO (local laptop)

## 1. Publish MCP server to npm

This lets anyone run `npx nogit-mcp` without cloning the repo.

```bash
# Login (one-time, interactive -- needs username/password/email/OTP)
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm login

# Publish from the mcp/ directory
cd /Users/anilyash/noGIT/mcp
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm publish --access public
```

After this, registration becomes:
```bash
claude mcp add nogit-mcp -- npx nogit-mcp --watch
```

If the name `nogit-mcp` is taken, try `@yashanil98/nogit-mcp` (scoped package):
- Change `"name"` in `mcp/package.json` to `"@yashanil98/nogit-mcp"`
- Publish with `npm publish --access public`

## 2. Publish VS Code extension v0.5.0

### Prerequisites (one-time setup, already done from 0.4.0)

- Publisher `yashanil98` exists at https://marketplace.visualstudio.com/manage
- You have a Personal Access Token (PAT) from dev.azure.com with Marketplace > Manage scope
- If the PAT expired: dev.azure.com > avatar > Personal access tokens > New Token
  - Organization: All accessible organizations
  - Scopes: Custom defined > Marketplace > Manage
  - Copy the token immediately (shown only once)

### Publish steps

```bash
cd /Users/anilyash/noGIT

# Verify tests pass
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm test
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm test --prefix mcp

# Bump version (updates package.json + creates a git commit)
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm version minor
# This changes 0.4.0 -> 0.5.0

# Set your token
export VSCE_PAT=<paste-token-here>

# Verify what will ship (should list: CHANGELOG.md, dist/extension.js, LICENSE, media/icon.png, package.json, README.md)
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 ls --no-dependencies

# Publish
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 publish --no-dependencies

# Push the version bump commit + tag
git push origin main --tags
```

The listing goes live in a few minutes at:
https://marketplace.visualstudio.com/items?itemName=yashanil98.nogit

### What changed since 0.4.0 (for the changelog)

The [Unreleased] section in CHANGELOG.md already has everything. Before publishing, move it under a `## [0.5.0]` heading. The key additions:
- MCP server for terminal AI agents (14 tools, --watch mode)
- Auto-burst checkpoints
- Exact restore (deletes added files)
- Public API additions (latestCheckpoint, onDidChangeSnapshots)
- Many reliability fixes (snapshot ordering, backup protection, pruning)

## 3. After publishing both

- Verify: `code --install-extension yashanil98.nogit` installs 0.5.0
- Verify: `npx nogit-mcp --version` prints 0.1.0
- Update the MCP registration to use npx:
  ```bash
  claude mcp remove nogit-mcp
  claude mcp add nogit-mcp -- npx nogit-mcp --watch
  ```
- Delete the old .vsix file: `rm /Users/anilyash/noGIT/nogit-0.4.0.vsix`
