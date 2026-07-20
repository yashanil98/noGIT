import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'src', 'server.js');

let tmpDir: string;

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nogit-mcp-srv-'));
}

class McpClient {
  private server: ChildProcess;
  private buf = '';
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(root: string) {
    this.server = spawn('node', [SERVER_PATH, '--root', root], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.server.stdout!.on('data', (d: Buffer) => {
      this.buf += d.toString();
      this.drain();
    });
  }

  private drain() {
    while (true) {
      const idx = this.buf.indexOf('\n');
      if (idx === -1) break;
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as Record<string, unknown>;
      const id = msg.id as number | undefined;
      if (id !== undefined && this.pending.has(id)) {
        const p = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(p.timer);
        p.resolve(msg);
      }
    }
  }

  send(msg: unknown) {
    this.server.stdin!.write(JSON.stringify(msg) + '\n');
  }

  request(id: number, method: string, params: unknown = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout')); }, 5000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async init() {
    await this.request(1, 'initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' }
    });
    this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async toolCall(id: number, name: string, args: Record<string, string> = {}): Promise<Record<string, unknown>> {
    return this.request(id, 'tools/call', { name, arguments: args });
  }

  kill() {
    this.server.kill();
  }
}

function getText(resp: Record<string, unknown>): string {
  const result = resp.result as Record<string, unknown>;
  const content = result.content as Array<Record<string, string>>;
  return content[0].text;
}

let client: McpClient;

describe('MCP server integration', () => {
  beforeEach(async () => {
    tmpDir = await makeTmp();
    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const x = 1;\n');
    await fs.writeFile(path.join(tmpDir, 'readme.md'), '# Hello\n');
    client = new McpClient(tmpDir);
    await client.init();
  });

  afterEach(async () => {
    client.kill();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('nogit_status reports workspace root', async () => {
    const resp = await client.toolCall(10, 'nogit_status');
    const text = getText(resp);
    assert.ok(text.includes('Workspace:'));
    assert.ok(text.includes('Snapshots: 0'));
  });

  it('nogit_checkpoint and nogit_list_snapshots round-trip', async () => {
    const cp = await client.toolCall(10, 'nogit_checkpoint', { label: 'test' });
    assert.ok(getText(cp).includes('2 files'));

    const list = await client.toolCall(11, 'nogit_list_snapshots');
    assert.ok(getText(list).includes('[test]'));
  });

  it('nogit_snapshot_now captures files', async () => {
    const snap = await client.toolCall(10, 'nogit_snapshot_now');
    assert.ok(getText(snap).includes('2 files'));
  });

  it('nogit_diff shows changes', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'cp' });
    const list = await client.toolCall(11, 'nogit_list_snapshots');
    const ts = getText(list).split(' ')[0];

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const x = 2;\n');
    const diff = await client.toolCall(12, 'nogit_diff', { timestamp: ts, path: 'app.ts' });
    const text = getText(diff);
    assert.ok(text.includes('-const x = 1;'));
    assert.ok(text.includes('+const x = 2;'));
  });

  it('nogit_diff_summary shows modified and added files', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'cp' });
    const list = await client.toolCall(11, 'nogit_list_snapshots');
    const ts = getText(list).split(' ')[0];

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const x = 2;\n');
    await fs.writeFile(path.join(tmpDir, 'new.ts'), 'new file\n');

    const summary = await client.toolCall(12, 'nogit_diff_summary', { timestamp: ts });
    const text = getText(summary);
    assert.ok(text.includes('M app.ts'));
    assert.ok(text.includes('A new.ts'));
  });

  it('nogit_restore_file restores content', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'cp' });
    const list = await client.toolCall(11, 'nogit_list_snapshots');
    const ts = getText(list).split(' ')[0];

    await fs.writeFile(path.join(tmpDir, 'app.ts'), 'const x = 99;\n');
    await client.toolCall(12, 'nogit_restore_file', { timestamp: ts, path: 'app.ts' });

    const content = await fs.readFile(path.join(tmpDir, 'app.ts'), 'utf8');
    assert.equal(content, 'const x = 1;\n');
  });

  it('nogit_snapshot_files lists captured files', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'cp' });
    const list = await client.toolCall(11, 'nogit_list_snapshots');
    const ts = getText(list).split(' ')[0];

    const files = await client.toolCall(12, 'nogit_snapshot_files', { timestamp: ts });
    const text = getText(files);
    assert.ok(text.includes('app.ts'));
    assert.ok(text.includes('readme.md'));
  });

  it('nogit_delete_snapshot removes a snapshot', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'doomed' });
    const list1 = await client.toolCall(11, 'nogit_list_snapshots');
    const ts = getText(list1).split(' ')[0];

    await client.toolCall(12, 'nogit_delete_snapshot', { timestamp: ts });

    const list2 = await client.toolCall(13, 'nogit_list_snapshots');
    assert.ok(!getText(list2).includes(ts));
  });

  it('nogit_latest_checkpoint returns newest labeled snapshot', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'first' });
    await client.toolCall(11, 'nogit_checkpoint', { label: 'second' });

    const resp = await client.toolCall(12, 'nogit_latest_checkpoint');
    assert.ok(getText(resp).includes('[second]'));
  });

  it('rejects path traversal with clear error', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'safe' });

    const diffResp = await client.toolCall(11, 'nogit_diff', { path: '../../../etc/passwd' });
    assert.ok(getText(diffResp).includes('escapes the workspace root'));

    const readResp = await client.toolCall(12, 'nogit_read_file', { path: '../../secret.txt' });
    assert.ok(getText(readResp).includes('escapes the workspace root'));

    const restoreResp = await client.toolCall(13, 'nogit_restore_file', { timestamp: 'safe', path: '../escape.txt' });
    assert.ok(getText(restoreResp).includes('escapes the workspace root'));
  });

  it('does not promise undo when nothing was restored', async () => {
    await client.toolCall(10, 'nogit_checkpoint', { label: 'base' });

    // Restore when workspace already matches checkpoint (nothing to change)
    const resp = await client.toolCall(11, 'nogit_restore_snapshot', { timestamp: 'base' });
    const text = getText(resp);
    // restored=N files, but the undo message should only appear if files changed
    if (text.includes('Restored 0')) {
      assert.ok(!text.includes('To undo'), 'should not promise undo when 0 files restored');
    }
  });
});
