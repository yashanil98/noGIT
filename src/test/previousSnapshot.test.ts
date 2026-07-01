import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPreviousSnapshotWithFile } from '../previousSnapshot';

const SNAPS = [
  { timestamp: '20260101-100000', files: ['a.ts', 'b.ts'] },
  { timestamp: '20260101-110000', files: ['a.ts'] },
  { timestamp: '20260101-120000', files: ['a.ts', 'b.ts'] },
];

test('finds the most recent older snapshot that captured the file', () => {
  assert.equal(findPreviousSnapshotWithFile(SNAPS, '20260101-120000', 'a.ts'), '20260101-110000');
});

test('skips older snapshots that did not capture the file', () => {
  // b.ts is absent from the 11:00 snapshot, so its previous is 10:00.
  assert.equal(findPreviousSnapshotWithFile(SNAPS, '20260101-120000', 'b.ts'), '20260101-100000');
});

test('returns undefined when there is no earlier version', () => {
  assert.equal(findPreviousSnapshotWithFile(SNAPS, '20260101-100000', 'a.ts'), undefined);
  assert.equal(findPreviousSnapshotWithFile(SNAPS, '20260101-120000', 'missing.ts'), undefined);
});

test('ignores the reference snapshot itself and any newer ones', () => {
  // From the 11:00 snapshot, only 10:00 is older; 12:00 must not be chosen.
  assert.equal(findPreviousSnapshotWithFile(SNAPS, '20260101-110000', 'a.ts'), '20260101-100000');
});

test('handles unsorted input', () => {
  const shuffled = [SNAPS[2], SNAPS[0], SNAPS[1]];
  assert.equal(findPreviousSnapshotWithFile(shuffled, '20260101-120000', 'a.ts'), '20260101-110000');
});
