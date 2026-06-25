import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { isRealPathInside } from '../realpath';

async function tmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nogit-realpath-'));
  return fs.realpath(dir); // macOS /tmp is itself a symlink
}

test('allows an ordinary nested path inside the root', async () => {
  const root = await tmpRoot();
  const work = path.join(root, 'work');
  await fs.mkdir(work, { recursive: true });
  assert.equal(await isRealPathInside(work, path.join(work, 'src', 'app.ts')), true);
});

test('refuses a path that escapes through a symlinked directory component', async () => {
  const root = await tmpRoot();
  const work = path.join(root, 'work');
  const outside = path.join(root, 'outside');
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  // work/link -> outside ; a write to work/link/secret lands in outside
  await fs.symlink(outside, path.join(work, 'link'), 'dir');
  assert.equal(await isRealPathInside(work, path.join(work, 'link', 'secret')), false);
});

test('refuses a symlinked leaf that points outside the root', async () => {
  const root = await tmpRoot();
  const work = path.join(root, 'work');
  const outside = path.join(root, 'outside');
  await fs.mkdir(work, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  const targetFile = path.join(outside, 'target');
  await fs.writeFile(targetFile, 'x');
  await fs.symlink(targetFile, path.join(work, 'leaf'), 'file');
  assert.equal(await isRealPathInside(work, path.join(work, 'leaf')), false);
});
