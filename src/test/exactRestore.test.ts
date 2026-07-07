import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filesToDeleteForExactRestore } from '../exactRestore';

test('deletes files present now but absent from the checkpoint', () => {
  const current = ['a.ts', 'b.ts', 'new.ts'];
  const checkpoint = ['a.ts', 'b.ts'];
  assert.deepEqual(filesToDeleteForExactRestore(current, checkpoint), ['new.ts']);
});

test('deletes nothing when the workspace matches the checkpoint', () => {
  const files = ['a.ts', 'b.ts'];
  assert.deepEqual(filesToDeleteForExactRestore(files, files), []);
});

test('does not delete a checkpoint file that is currently missing', () => {
  // b.ts was deleted by the agent; exact restore re-creates it via the normal
  // additive copy, it is not part of the delete set.
  const current = ['a.ts'];
  const checkpoint = ['a.ts', 'b.ts'];
  assert.deepEqual(filesToDeleteForExactRestore(current, checkpoint), []);
});

test('preserves the order of the current listing', () => {
  const current = ['z.ts', 'a.ts', 'm.ts'];
  const checkpoint = ['a.ts'];
  assert.deepEqual(filesToDeleteForExactRestore(current, checkpoint), ['z.ts', 'm.ts']);
});

test('handles empty inputs', () => {
  assert.deepEqual(filesToDeleteForExactRestore([], ['a.ts']), []);
  assert.deepEqual(filesToDeleteForExactRestore(['a.ts'], []), ['a.ts']);
});
