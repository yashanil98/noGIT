#!/bin/bash
# Quick demo of nogit-mcp: checkpoint, modify, diff, restore, undo.
# Run from the mcp/ directory after `npm install && npm run build`.
set -e

NODE="${NODE:-node}"
SERVER="$(dirname "$0")/dist/src/server.js"
DEMO_DIR="$(mktemp -d)"
trap 'rm -rf "$DEMO_DIR"' EXIT

echo "=== noGIT MCP Demo ==="
echo "Workspace: $DEMO_DIR"
echo ""

# Create some files
echo 'function hello() { return "world"; }' > "$DEMO_DIR/app.js"
echo '# My Project' > "$DEMO_DIR/README.md"
echo "Created 2 files: app.js, README.md"

# Helper: send a JSON-RPC message and get the response
call() {
  local id="$1" method="$2" params="$3"
  echo "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"$method\",\"params\":$params}"
}

# Run the server, pipe messages, collect responses
{
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}'
  sleep 0.3
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  sleep 0.1

  echo ""
  echo "--- 1. Checkpoint the workspace ---"
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"nogit_checkpoint","arguments":{"label":"before changes"}}}'
  sleep 0.5

  # Modify files
  echo 'function hello() { return "BROKEN"; }' > "$DEMO_DIR/app.js"
  echo '# DELETED' > "$DEMO_DIR/README.md"
  echo 'console.log("new file")' > "$DEMO_DIR/new.js"

  echo ""
  echo "--- 2. Modified app.js, README.md, added new.js ---"
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nogit_diff_summary","arguments":{}}}'
  sleep 0.5

  echo ""
  echo "--- 3. Diff app.js ---"
  echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"nogit_diff","arguments":{"path":"app.js"}}}'
  sleep 0.5

  echo ""
  echo "--- 4. Exact restore (undo everything) ---"
  echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nogit_restore_checkpoint_exact","arguments":{}}}'
  sleep 0.5

  echo ""
  echo "--- 5. Undo the restore (bring changes back) ---"
  echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"nogit_undo","arguments":{}}}'
  sleep 0.5
} | "$NODE" "$SERVER" --root "$DEMO_DIR" 2>/dev/null | while IFS= read -r line; do
  # Extract the text content from JSON-RPC responses
  text=$(echo "$line" | "$NODE" -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const r=JSON.parse(d);if(r.result?.content)console.log(r.result.content[0].text);
      else if(r.result?.instructions)console.log('[Connected: '+r.result.serverInfo.name+']');}catch{}
    });" 2>/dev/null)
  if [ -n "$text" ]; then
    echo "$text"
    echo ""
  fi
done

echo "=== Demo complete ==="
