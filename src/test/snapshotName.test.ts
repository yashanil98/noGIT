import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniqueSnapshotName } from '../snapshotName';

test('returns the base name when nothing collides', () => {
  assert.equal(uniqueSnapshotName('20260615-120000', []), '20260615-120000');
  assert.equal(uniqueSnapshotName('20260615-120000', ['20260615-110000']), '20260615-120000');
});

test('suffixes -2 on the first collision', () => {
  assert.equal(uniqueSnapshotName('20260615-120000', ['20260615-120000']), '20260615-120000-2');
});

test('keeps incrementing past repeated collisions', () => {
  const taken = ['20260615-120000', '20260615-120000-2', '20260615-120000-3'];
  assert.equal(uniqueSnapshotName('20260615-120000', taken), '20260615-120000-4');
});

test('accepts a Set as well as an array', () => {
  const taken = new Set(['20260615-120000']);
  assert.equal(uniqueSnapshotName('20260615-120000', taken), '20260615-120000-2');
});

test('the suffixed name still sorts after its base and before the next second', () => {
  // Newest-first ordering is by folder name, so a -2 suffix must sort between
  // its own second and the following one.
  assert.ok('20260615-120000' < '20260615-120000-2');
  assert.ok('20260615-120000-2' < '20260615-120001');
});
