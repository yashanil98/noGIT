# TODO (local laptop)

## Publish

1. **npm login** and publish the MCP server package:
   ```bash
   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm login
   cd mcp && npm publish
   ```
   After this, `npx nogit-mcp --watch` works globally.

2. **Bump extension to v0.5.0** and publish to VS Code Marketplace:
   ```bash
   cd /Users/anilyash/noGIT
   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm version minor
   export VSCE_PAT=<your-token-from-dev.azure.com>
   PATH="/opt/homebrew/opt/node@20/bin:$PATH" npx @vscode/vsce@2 publish --no-dependencies
   ```
   If your PAT expired, make a new one: dev.azure.com > User settings > Personal access tokens > New Token (Marketplace > Manage scope, All accessible organizations).
