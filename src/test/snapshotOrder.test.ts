import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshotNames } from '../snapshotOrder';

test('orders by timestamp base when there is no suffix', () => {
  assert.ok(compareSnapshotNames('20260615-120000', '20260615-120001') < 0);
  assert.ok(compareSnapshotNames('20260615-120001', '20260615-120000') > 0);
  assert.equal(compareSnapshotNames('20260615-120000', '20260615-120000'), 0);
});

test('the unsuffixed base sorts before its collision siblings', () => {
  assert.ok(compareSnapshotNames('20260615-120000', '20260615-120000-2') < 0);
  assert.ok(compareSnapshotNames('20260615-120000-2', '20260615-120000') > 0);
});

test('collision suffixes compare numerically, not lexically', () => {
  // The bug this guards against: string order puts "-10" before "-2".
  assert.ok(compareSnapshotNames('20260615-120000-2', '20260615-120000-10') < 0);
  assert.ok(compareSnapshotNames('20260615-120000-10', '20260615-120000-2') > 0);
  assert.ok(compareSnapshotNames('20260615-120000-9', '20260615-120000-11') < 0);
});

test('sorting a full same-second burst yields creation order', () => {
  const names = [
    '20260615-120000-10',
    '20260615-120000',
    '20260615-120000-2',
    '20260615-120000-11',
    '20260615-120000-3',
  ];
  assert.deepEqual([...names].sort(compareSnapshotNames), [
    '20260615-120000',
    '20260615-120000-2',
    '20260615-120000-3',
    '20260615-120000-10',
    '20260615-120000-11',
  ]);
});

test('a later second outranks any suffix of an earlier second', () => {
  assert.ok(
    compareSnapshotNames('20260615-120000-99', '20260615-120001') < 0,
  );
});

test('falls back to string comparison for malformed names', () => {
  assert.ok(compareSnapshotNames('zzz', 'aaa') > 0);
  assert.equal(compareSnapshotNames('weird', 'weird'), 0);
});
