import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uncapturedFiles } from '../uncaptured';

test('returns nothing when every claimed file was captured', () => {
  assert.deepEqual(uncapturedFiles(['a', 'b', 'c'], ['a', 'b', 'c']), []);
});

test('returns the claimed files that were not captured', () => {
  // b and c failed to copy (size cap, read error) and must be retried.
  assert.deepEqual(uncapturedFiles(['a', 'b', 'c'], ['a']), ['b', 'c']);
});

test('preserves the order of the claimed list', () => {
  assert.deepEqual(uncapturedFiles(['x', 'y', 'z'], ['y']), ['x', 'z']);
});

test('captured files not among the claimed do not matter', () => {
  // An edit that arrived mid-write re-marked its own file; it is not in claimed,
  // so it is untouched here and stays pending on its own.
  assert.deepEqual(uncapturedFiles(['a', 'b'], ['a', 'b', 'other']), []);
});

test('empty claimed set yields nothing', () => {
  assert.deepEqual(uncapturedFiles([], ['a']), []);
});

test('nothing captured re-marks the whole claimed set', () => {
  assert.deepEqual(uncapturedFiles(['a', 'b'], []), ['a', 'b']);
});
