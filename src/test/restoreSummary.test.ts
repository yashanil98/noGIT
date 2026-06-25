import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRestoreSummary } from '../restoreSummary';

const STAMP = '2026-06-24 09:00:00';

test('a clean restore reports the count and offers undo', () => {
  const s = buildRestoreSummary(STAMP, 3, []);
  assert.equal(s.offerUndo, true);
  assert.ok(s.message.includes('restored 3 file(s)'));
  assert.ok(s.message.includes(STAMP));
  assert.ok(!s.message.toLowerCase().includes('skipped'));
});

test('a single skipped file is listed and undo is withheld', () => {
  const s = buildRestoreSummary(STAMP, 2, ['src/app.ts']);
  assert.equal(s.offerUndo, false);
  assert.ok(s.message.includes('Skipped 1'));
  assert.ok(s.message.includes('src/app.ts'));
  assert.ok(s.message.includes(STAMP));
});

test('multiple skipped files are joined with a comma and space', () => {
  const s = buildRestoreSummary(STAMP, 0, ['a.ts', 'b.ts']);
  assert.equal(s.offerUndo, false);
  assert.ok(s.message.includes('Skipped 2'));
  assert.ok(s.message.includes('a.ts, b.ts'));
});

test('uses the formatted stamp it is given, never a raw value', () => {
  // The caller passes formatStamp(ts); the summary must not invent its own.
  const s = buildRestoreSummary(STAMP, 1, []);
  assert.ok(!s.message.includes('-'.repeat(0) + '20260624'));
});
