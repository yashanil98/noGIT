import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { toWorkspaceRel, isInside, isWithinSnapshotFolder } from '../paths';

const ROOT = path.sep === '\\' ? 'C:\\work\\proj' : '/work/proj';
const J = (...parts: string[]) => path.join(ROOT, ...parts);

test('toWorkspaceRel returns a posix relative path for a nested file', () => {
  assert.equal(toWorkspaceRel(ROOT, J('src', 'app.ts')), 'src/app.ts');
});

test('toWorkspaceRel rejects the root itself', () => {
  assert.equal(toWorkspaceRel(ROOT, ROOT), undefined);
});

test('toWorkspaceRel rejects a parent-escaping path', () => {
  assert.equal(toWorkspaceRel(ROOT, J('..', 'secret.txt')), undefined);
  assert.equal(toWorkspaceRel(ROOT, path.dirname(ROOT)), undefined);
});

test('toWorkspaceRel rejects a sibling that merely shares the root prefix', () => {
  // /work/proj-evil must not be treated as inside /work/proj.
  const sibling = ROOT + '-evil' + path.sep + 'x.txt';
  assert.equal(toWorkspaceRel(ROOT, sibling), undefined);
});

test('toWorkspaceRel accepts filenames beginning with .. (not traversal)', () => {
  // A root-level name that merely begins with two dots stays inside the root --
  // it is NOT a "../" escape. A bare startsWith('..') check wrongly dropped such
  // files from snapshots (silent data loss).
  assert.equal(toWorkspaceRel(ROOT, J('..doubledot.txt')), '..doubledot.txt');
  assert.equal(toWorkspaceRel(ROOT, J('...tripledot')), '...tripledot');
  assert.equal(toWorkspaceRel(ROOT, J('sub', '..hidden')), 'sub/..hidden');
  // Genuine traversals are still rejected.
  assert.equal(toWorkspaceRel(ROOT, J('..', 'secret')), undefined);
});

test('isInside accepts the root and nested paths, rejects escapes', () => {
  assert.equal(isInside(ROOT, J('a', 'b.txt')), true);
  assert.equal(isInside(ROOT, ROOT), true);
  assert.equal(isInside(ROOT, J('..', 'x')), false);
  assert.equal(isInside(ROOT, ROOT + '-evil'), false);
});

test('isWithinSnapshotFolder matches the folder and its children only', () => {
  assert.equal(isWithinSnapshotFolder('.nogit', '.nogit'), true);
  assert.equal(isWithinSnapshotFolder('.nogit/snapshots/x', '.nogit'), true);
  // Siblings that merely share the name prefix must not count as inside.
  assert.equal(isWithinSnapshotFolder('.nogitignore', '.nogit'), false);
  assert.equal(isWithinSnapshotFolder('.nogitX/file', '.nogit'), false);
  assert.equal(isWithinSnapshotFolder('src/app.ts', '.nogit'), false);
  // Honors a custom folder name.
  assert.equal(isWithinSnapshotFolder('history/a', 'history'), true);
});
