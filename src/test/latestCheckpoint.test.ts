import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLatestCheckpoint } from '../latestCheckpoint';

test('returns undefined when there are no snapshots', () => {
  assert.equal(findLatestCheckpoint([]), undefined);
});

test('returns undefined when no snapshot has a label', () => {
  const snaps = [
    { timestamp: '20260101-100000' },
    { timestamp: '20260101-110000', label: '' },
  ];
  assert.equal(findLatestCheckpoint(snaps), undefined);
});

test('picks the newest labelled snapshot, ignoring auto-snapshots', () => {
  const snaps = [
    { timestamp: '20260101-100000', label: 'before refactor' },
    { timestamp: '20260101-110000' },                          // auto, newer, no label
    { timestamp: '20260101-105000', label: 'before agent' },
  ];
  const latest = findLatestCheckpoint(snaps);
  assert.equal(latest?.timestamp, '20260101-105000');
  assert.equal(latest?.label, 'before agent');
});

test('does not require sorted input', () => {
  const snaps = [
    { timestamp: '20260101-120000', label: 'c' },
    { timestamp: '20260101-100000', label: 'a' },
    { timestamp: '20260101-110000', label: 'b' },
  ];
  assert.equal(findLatestCheckpoint(snaps)?.label, 'c');
});

test('orders collision suffixes numerically within a second', () => {
  // -10 is newer than -2 but sorts before it as text.
  const snaps = [
    { timestamp: '20260101-120000-2', label: 'second' },
    { timestamp: '20260101-120000-10', label: 'tenth' },
  ];
  assert.equal(findLatestCheckpoint(snaps)?.label, 'tenth');
});
