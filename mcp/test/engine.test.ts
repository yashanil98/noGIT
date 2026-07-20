import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SnapshotEngine, SnapshotInfo } from '../src/engine.js';

let tmpDir: string;

async function makeTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nogit-mcp-test-'));
}

async function writeFile(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

async function readFile(root: string, rel: string): Promise<string> {
  return fs.readFile(path.join(root, rel), 'utf8');
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

describe('SnapshotEngine', () => {
  beforeEach(async () => {
    tmpDir = await makeTmp();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('checkpoint captures all workspace files', async () => {
    await writeFile(tmpDir, 'a.txt', 'hello');
    await writeFile(tmpDir, 'sub/b.txt', 'world');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts, fileCount } = await engine.checkpoint('test-cp');
    assert.ok(ts);
    assert.equal(fileCount, 2);
  });

  it('listSnapshots returns checkpoints newest first', async () => {
    await writeFile(tmpDir, 'a.txt', 'v1');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('first');
    await writeFile(tmpDir, 'a.txt', 'v2');
    await engine.checkpoint('second');
    const snaps = await engine.listSnapshots();
    assert.equal(snaps.length, 2);
    assert.equal(snaps[0].label, 'second');
    assert.equal(snaps[1].label, 'first');
  });

  it('latestCheckpoint returns the newest labeled snapshot', async () => {
    await writeFile(tmpDir, 'a.txt', 'content');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('alpha');
    await engine.snapshotNow();
    await engine.checkpoint('beta');
    const cp = await engine.latestCheckpoint();
    assert.ok(cp);
    assert.equal(cp.label, 'beta');
  });

  it('snapshotNow captures the workspace', async () => {
    await writeFile(tmpDir, 'file.txt', 'data');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts, fileCount } = await engine.snapshotNow();
    assert.ok(ts);
    assert.equal(fileCount, 1);
  });

  it('restoreFile restores a file from a snapshot', async () => {
    await writeFile(tmpDir, 'a.txt', 'original');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'a.txt', 'modified');
    const result = await engine.restoreFile(ts, 'a.txt');
    assert.equal(result.ok, true);
    const content = await readFile(tmpDir, 'a.txt');
    assert.equal(content, 'original');
  });

  it('restoreSnapshot restores all files and reports skipped', async () => {
    await writeFile(tmpDir, 'a.txt', 'A');
    await writeFile(tmpDir, 'b.txt', 'B');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'a.txt', 'changed-A');
    await writeFile(tmpDir, 'b.txt', 'changed-B');
    const { restored, skipped } = await engine.restoreSnapshot(ts);
    assert.equal(restored, 2);
    assert.equal(skipped.length, 0);
    assert.equal(await readFile(tmpDir, 'a.txt'), 'A');
    assert.equal(await readFile(tmpDir, 'b.txt'), 'B');
  });

  it('restoreCheckpointExact deletes files added after the checkpoint', async () => {
    await writeFile(tmpDir, 'a.txt', 'keep');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'new.txt', 'added');
    const result = await engine.restoreCheckpointExact(ts);
    assert.ok(result);
    assert.equal(result.restored, 1);
    assert.equal(result.deleted, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(await exists(path.join(tmpDir, 'new.txt')), false);
    assert.equal(await readFile(tmpDir, 'a.txt'), 'keep');
  });

  it('diff returns unified diff text with context', async () => {
    await writeFile(tmpDir, 'a.txt', 'line1\nline2\nline3\nline4\nline5\n');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'a.txt', 'line1\nline2\nchanged\nline4\nline5\n');
    const diff = await engine.diff(ts, 'a.txt');
    assert.ok(diff);
    assert.ok(diff.includes('--- a/a.txt'));
    assert.ok(diff.includes('+++ b/a.txt'));
    assert.ok(diff.includes('-line3'));
    assert.ok(diff.includes('+changed'));
    assert.ok(diff.includes(' line2'), 'should have context lines');
    assert.ok(diff.includes(' line4'), 'should have trailing context');
  });

  it('diff shows only changed hunks for large files', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line${i + 1}`);
    await writeFile(tmpDir, 'big.txt', lines.join('\n'));
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    lines[25] = 'CHANGED';
    await writeFile(tmpDir, 'big.txt', lines.join('\n'));
    const diff = await engine.diff(ts, 'big.txt');
    assert.ok(diff);
    assert.ok(diff.includes('-line26'));
    assert.ok(diff.includes('+CHANGED'));
    assert.ok(!diff.includes(' line1'), 'should not include far-away context');
    assert.ok(!diff.includes(' line50'), 'should not include far-away context');
  });

  it('diff returns empty string when file is unchanged', async () => {
    await writeFile(tmpDir, 'a.txt', 'same');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const diff = await engine.diff(ts, 'a.txt');
    assert.equal(diff, '');
  });

  it('excludes node_modules by default', async () => {
    await writeFile(tmpDir, 'a.txt', 'yes');
    await writeFile(tmpDir, 'node_modules/pkg/index.js', 'no');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { fileCount } = await engine.checkpoint('cp');
    assert.equal(fileCount, 1);
  });

  it('excludes .nogit folder from snapshots', async () => {
    await writeFile(tmpDir, 'a.txt', 'content');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('cp1');
    const { fileCount } = await engine.checkpoint('cp2');
    assert.equal(fileCount, 1);
  });

  it('manifest written by engine is parseable by the extension format', async () => {
    await writeFile(tmpDir, 'src/app.ts', 'const x = 1;');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('compat-test');
    assert.ok(ts);
    const metaPath = path.join(tmpDir, '.nogit', 'snapshots', ts, 'meta.json');
    const raw = await fs.readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.timestamp, ts);
    assert.ok(Array.isArray(parsed.files));
    assert.ok(parsed.files.includes('src/app.ts'));
    assert.equal(parsed.label, 'compat-test');
    assert.equal(/^\d{8}-\d{6}(?:-\d+)?$/.test(parsed.timestamp), true);
  });

  it('rejects path traversal in restoreFile', async () => {
    await writeFile(tmpDir, 'a.txt', 'safe');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const result = await engine.restoreFile(ts, '../escape.txt');
    assert.equal(result.ok, false);
  });

  it('rejects invalid timestamp in restoreFile', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const result = await engine.restoreFile('../../etc', 'a.txt');
    assert.equal(result.ok, false);
  });

  it('checkpoint with empty label is a no-op', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts, fileCount } = await engine.checkpoint('   ');
    assert.equal(ts, undefined);
    assert.equal(fileCount, 0);
  });

  it('pruning respects maxSnapshots', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir, maxSnapshots: 2 });
    await engine.snapshotNow();
    await engine.snapshotNow();
    await engine.snapshotNow();
    const snaps = await engine.listSnapshots();
    assert.equal(snaps.length, 2);
  });

  it('pruning does not delete checkpoints', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir, maxSnapshots: 1 });
    await engine.checkpoint('keep-me');
    await engine.snapshotNow();
    await engine.snapshotNow();
    const snaps = await engine.listSnapshots();
    const labels = snaps.filter(s => s.label === 'keep-me');
    assert.equal(labels.length, 1);
  });

  it('skips symlinks during snapshot', async () => {
    await writeFile(tmpDir, 'real.txt', 'content');
    await fs.symlink(path.join(tmpDir, 'real.txt'), path.join(tmpDir, 'link.txt'));
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const snaps = await engine.listSnapshots();
    assert.ok(!snaps[0].files.includes('link.txt'));
    assert.ok(snaps[0].files.includes('real.txt'));
  });

  it('deleteSnapshot removes a snapshot', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('doomed');
    assert.ok(ts);
    const ok = await engine.deleteSnapshot(ts);
    assert.equal(ok, true);
    const snaps = await engine.listSnapshots();
    assert.equal(snaps.filter(s => s.timestamp === ts).length, 0);
  });

  it('deleteSnapshot returns false for invalid timestamp', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const ok = await engine.deleteSnapshot('../../bad');
    assert.equal(ok, false);
  });

  it('getSnapshotFiles returns file list', async () => {
    await writeFile(tmpDir, 'a.txt', 'hello');
    await writeFile(tmpDir, 'b.txt', 'world');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const files = await engine.getSnapshotFiles(ts);
    assert.ok(files);
    assert.ok(files.includes('a.txt'));
    assert.ok(files.includes('b.txt'));
    assert.equal(files.length, 2);
  });

  it('getSnapshotFiles returns undefined for missing snapshot', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const files = await engine.getSnapshotFiles('99991231-235959');
    assert.equal(files, undefined);
  });

  it('diffSummary shows modified, added, and deleted files', async () => {
    await writeFile(tmpDir, 'keep.txt', 'keep');
    await writeFile(tmpDir, 'change.txt', 'original');
    await writeFile(tmpDir, 'remove.txt', 'will be deleted');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'change.txt', 'modified');
    await writeFile(tmpDir, 'new.txt', 'added');
    await fs.rm(path.join(tmpDir, 'remove.txt'));
    const summary = await engine.diffSummary(ts);
    assert.ok(summary);
    assert.ok(summary.modified.includes('change.txt'));
    assert.ok(summary.added.includes('new.txt'));
    assert.ok(summary.deleted.includes('remove.txt'));
    assert.ok(!summary.modified.includes('keep.txt'));
  });

  it('diffSummary returns undefined for invalid timestamp', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const result = await engine.diffSummary('bad-ts');
    assert.equal(result, undefined);
  });

  it('diff detects binary files gracefully', async () => {
    const binContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x01]);
    await fs.writeFile(path.join(tmpDir, 'img.png'), binContent);
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await fs.writeFile(path.join(tmpDir, 'img.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    const diff = await engine.diff(ts, 'img.png');
    assert.ok(diff);
    assert.ok(diff.includes('Binary file'));
  });

  it('diff returns empty for identical binary files', async () => {
    const binContent = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await fs.writeFile(path.join(tmpDir, 'data.bin'), binContent);
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const diff = await engine.diff(ts, 'data.bin');
    assert.equal(diff, '');
  });

  it('diff detects trailing newline changes', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await fs.writeFile(path.join(tmpDir, 'a.txt'), 'hello\n');
    const diff = await engine.diff(ts, 'a.txt');
    assert.ok(diff);
    assert.ok(diff.includes('No newline at end of file'));
    assert.ok(diff.includes('-hello'));
    assert.ok(diff.includes('+hello'));
  });

  it('skips files over maxFileSizeBytes', async () => {
    await writeFile(tmpDir, 'small.txt', 'hi');
    await writeFile(tmpDir, 'big.txt', 'x'.repeat(200));
    const engine = new SnapshotEngine({ root: tmpDir, maxFileSizeBytes: 100 });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const snaps = await engine.listSnapshots();
    assert.ok(snaps[0].files.includes('small.txt'));
    assert.ok(!snaps[0].files.includes('big.txt'));
  });

  it('undo reverses the most recent restore', async () => {
    await writeFile(tmpDir, 'a.txt', 'original');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'a.txt', 'modified');
    await engine.restoreFile(ts, 'a.txt');
    assert.equal(await readFile(tmpDir, 'a.txt'), 'original');
    const undoResult = await engine.undo();
    assert.ok(undoResult);
    assert.ok(undoResult.restored > 0);
    assert.equal(await readFile(tmpDir, 'a.txt'), 'modified');
  });

  it('undo returns undefined when no restore was done', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const result = await engine.undo();
    assert.equal(result, undefined);
  });

  it('undo chains: undo-the-undo restores back', async () => {
    await writeFile(tmpDir, 'a.txt', 'v1');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'a.txt', 'v2');
    await engine.restoreFile(ts, 'a.txt');
    // file is now v1; undo brings it back to v2
    const first = await engine.undo();
    assert.ok(first);
    assert.equal(await readFile(tmpDir, 'a.txt'), 'v2');
    // undo again brings it back to v1 (undo-the-undo)
    const second = await engine.undo();
    assert.ok(second);
    assert.equal(await readFile(tmpDir, 'a.txt'), 'v1');
  });

  it('resolveTimestamp finds checkpoint by label', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('my-label');
    const ts = await engine.resolveTimestamp('my-label');
    assert.ok(ts);
    assert.ok(/^\d{8}-\d{6}/.test(ts));
  });

  it('resolveTimestamp finds checkpoint by case-insensitive substring', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('before-big-refactor');
    const ts = await engine.resolveTimestamp('BIG-REFACT');
    assert.ok(ts);
  });

  it('resolveTimestamp returns timestamp as-is when valid format', async () => {
    const engine = new SnapshotEngine({ root: tmpDir });
    const ts = await engine.resolveTimestamp('20260714-120000');
    assert.equal(ts, '20260714-120000');
  });

  it('resolveTimestamp returns undefined for empty or whitespace input', async () => {
    await writeFile(tmpDir, 'a.txt', 'x');
    const engine = new SnapshotEngine({ root: tmpDir });
    await engine.checkpoint('anything');
    assert.equal(await engine.resolveTimestamp(''), undefined);
    assert.equal(await engine.resolveTimestamp('   '), undefined);
  });

  it('readFile returns file content from a snapshot', async () => {
    await writeFile(tmpDir, 'code.ts', 'const x = 1;');
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    await writeFile(tmpDir, 'code.ts', 'const x = 2;');
    const content = await engine.readFile(ts, 'code.ts');
    assert.equal(content, 'const x = 1;');
  });

  it('readFile returns undefined for binary files', async () => {
    await fs.writeFile(path.join(tmpDir, 'img.png'), Buffer.from([0x89, 0x50, 0x00, 0x47]));
    const engine = new SnapshotEngine({ root: tmpDir });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const content = await engine.readFile(ts, 'img.png');
    assert.equal(content, undefined);
  });

  it('custom excludePatterns are respected', async () => {
    await writeFile(tmpDir, 'keep.txt', 'yes');
    await writeFile(tmpDir, 'logs/app.log', 'no');
    const engine = new SnapshotEngine({ root: tmpDir, excludePatterns: ['**/logs/**'] });
    const { ts, fileCount } = await engine.checkpoint('cp');
    assert.ok(ts);
    assert.equal(fileCount, 1);
    const files = await engine.getSnapshotFiles(ts);
    assert.ok(files!.includes('keep.txt'));
    assert.ok(!files!.includes('logs/app.log'));
  });

  it('bare name excludes match at any depth', async () => {
    await writeFile(tmpDir, '.env', 'ROOT_SECRET=x');
    await writeFile(tmpDir, 'src/.env.local', 'NESTED=y');
    await writeFile(tmpDir, 'config/.env', 'DEEP=z');
    await writeFile(tmpDir, 'app.ts', 'code');
    const engine = new SnapshotEngine({ root: tmpDir, excludePatterns: ['**/.env', '**/.env.local'] });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const files = await engine.getSnapshotFiles(ts);
    assert.ok(!files!.includes('.env'));
    assert.ok(!files!.includes('src/.env.local'));
    assert.ok(!files!.includes('config/.env'));
    assert.ok(files!.includes('app.ts'));
  });

  it('custom maxFileSizeBytes is respected', async () => {
    await writeFile(tmpDir, 'small.txt', 'hi');
    await writeFile(tmpDir, 'big.txt', 'x'.repeat(50));
    const engine = new SnapshotEngine({ root: tmpDir, maxFileSizeBytes: 30 });
    const { ts } = await engine.checkpoint('cp');
    assert.ok(ts);
    const files = await engine.getSnapshotFiles(ts);
    assert.ok(files!.includes('small.txt'));
    assert.ok(!files!.includes('big.txt'));
  });
});
