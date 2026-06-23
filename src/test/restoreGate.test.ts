import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRestoreSafely } from '../restoreGate';

test('safe to restore when the file does not currently exist (nothing to lose)', () => {
  assert.equal(canRestoreSafely(false, false), true);
  assert.equal(canRestoreSafely(false, true), true);
});

test('safe to restore over an existing file only when it was backed up', () => {
  assert.equal(canRestoreSafely(true, true), true);
});

test('refuses to overwrite an existing file that was not backed up', () => {
  assert.equal(canRestoreSafely(true, false), false);
});
