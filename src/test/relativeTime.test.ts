import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshotStamp, relativeTime } from '../relativeTime';

// A fixed reference point: 2026-06-15 12:00:00 local time.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const at = (y: number, mo: number, d: number, h: number, mi: number, s: number) =>
  new Date(y, mo - 1, d, h, mi, s).getTime();

test('parseSnapshotStamp reads a well-formed stamp as local time', () => {
  assert.equal(parseSnapshotStamp('20260615-120000'), at(2026, 6, 15, 12, 0, 0));
});

test('parseSnapshotStamp tolerates a collision suffix', () => {
  assert.equal(parseSnapshotStamp('20260615-120000-2'), at(2026, 6, 15, 12, 0, 0));
});

test('parseSnapshotStamp rejects malformed input', () => {
  assert.equal(parseSnapshotStamp('not-a-stamp'), undefined);
  assert.equal(parseSnapshotStamp(''), undefined);
});

test('relativeTime renders seconds as "just now"', () => {
  assert.equal(relativeTime('20260615-115930', NOW), 'just now'); // 30s ago
});

test('relativeTime renders minutes, hours, and days', () => {
  assert.equal(relativeTime('20260615-115500', NOW), '5m ago');
  assert.equal(relativeTime('20260615-090000', NOW), '3h ago');
  assert.equal(relativeTime('20260613-120000', NOW), '2d ago');
});

test('relativeTime treats a future stamp as "just now" rather than negative', () => {
  assert.equal(relativeTime('20260615-120030', NOW), 'just now'); // 30s in the future
});

test('relativeTime falls back to the raw stamp when unparseable', () => {
  assert.equal(relativeTime('garbage', NOW), 'garbage');
});
