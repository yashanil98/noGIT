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

test('lists up to ten skipped files in full', () => {
  const files = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
  const s = buildRestoreSummary(STAMP, 0, files);
  assert.ok(s.message.includes('Skipped 10'));
  assert.ok(s.message.includes('f9.ts'));
  assert.ok(!s.message.includes('more'));
});

test('summarizes the overflow when more than ten files are skipped', () => {
  const files = Array.from({ length: 25 }, (_, i) => `f${i}.ts`);
  const s = buildRestoreSummary(STAMP, 0, files);
  assert.equal(s.offerUndo, false);
  assert.ok(s.message.includes('Skipped 25'));
  assert.ok(s.message.includes('f0.ts'));   // first is listed
  assert.ok(s.message.includes('f9.ts'));   // tenth is listed
  assert.ok(!s.message.includes('f10.ts')); // eleventh is not spelled out
  assert.ok(s.message.includes('and 15 more'));
});

test('uses the formatted stamp it is given, never a raw value', () => {
  // The caller passes formatStamp(ts); the summary must not invent its own.
  const s = buildRestoreSummary(STAMP, 1, []);
  assert.ok(!s.message.includes('-'.repeat(0) + '20260624'));
});
