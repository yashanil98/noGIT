import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSnapshotStamp, relativeTime, formatStamp, formatTimestamp } from '../relativeTime';
import { isValidSnapshotName } from '../snapshotName';

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

test('relativeTime switches to weeks past two weeks but stays in days just under', () => {
  assert.equal(relativeTime('20260603-120000', NOW), '12d ago'); // under 14 days
  assert.equal(relativeTime('20260525-120000', NOW), '3w ago');  // 21 days
});

test('relativeTime floors units so it never overstates elapsed time', () => {
  // Under round() these each bumped up a unit and overstated the age.
  assert.equal(relativeTime('20260615-115915', NOW), 'just now'); // 45s -> under a minute
  assert.equal(relativeTime('20260615-115901', NOW), 'just now'); // 59s -> still under a minute
  assert.equal(relativeTime('20260615-115900', NOW), '1m ago');   // exactly 60s
  assert.equal(relativeTime('20260615-110800', NOW), '52m ago');  // 52m, not "1h ago"
  assert.equal(relativeTime('20260614-123000', NOW), '23h ago');  // 23h30m, not "1d ago"
  assert.equal(relativeTime('20260602-000000', NOW), '13d ago');  // ~13.5d, not "2w ago"
});

test('relativeTime treats a future stamp as "just now" rather than negative', () => {
  assert.equal(relativeTime('20260615-120030', NOW), 'just now'); // 30s in the future
});

test('relativeTime falls back to the raw stamp when unparseable', () => {
  assert.equal(relativeTime('garbage', NOW), 'garbage');
});

test('formatStamp renders a readable absolute time and drops any suffix', () => {
  assert.equal(formatStamp('20260615-120000'), '2026-06-15 12:00:00');
  assert.equal(formatStamp('20260615-120000-2'), '2026-06-15 12:00:00');
  assert.equal(formatStamp('garbage'), 'garbage');
});

test('formatTimestamp zero-pads and uses a one-based month', () => {
  // January (month index 0) must encode as 01, single digits must pad.
  assert.equal(formatTimestamp(new Date(2026, 0, 5, 3, 7, 9)), '20260105-030709');
});

test('formatTimestamp output is a valid snapshot name and round-trips', () => {
  const d = new Date(2026, 5, 15, 12, 0, 0);
  const ts = formatTimestamp(d);
  assert.equal(isValidSnapshotName(ts), true);
  assert.equal(parseSnapshotStamp(ts), d.getTime());
});
