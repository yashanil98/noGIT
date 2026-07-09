import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideFolderTransition } from '../folderTransition';

test('no folder bound and none open is a no-op', () => {
  assert.equal(decideFolderTransition(undefined, undefined), 'none');
});

test('binds when a first folder appears in a window that had none', () => {
  assert.equal(decideFolderTransition(undefined, '/work/a'), 'bind');
});

test('no-op when the bound folder is still the first folder', () => {
  assert.equal(decideFolderTransition('/work/a', '/work/a'), 'none');
});

test('rebinds when a different folder becomes first', () => {
  // The bound first root was removed from a multi-root workspace, so the folder
  // that used to be second is now first. Previously this was silently ignored
  // and snapshots kept going to the removed folder.
  assert.equal(decideFolderTransition('/work/a', '/work/b'), 'rebind');
});

test('unbinds when the last folder is removed', () => {
  assert.equal(decideFolderTransition('/work/a', undefined), 'unbind');
});
