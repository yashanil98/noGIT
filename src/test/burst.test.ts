import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBurst, burstLabel } from '../burst';

test('a run at or above the threshold is a burst', () => {
  assert.equal(isBurst(5, { minFiles: 5 }), true);
  assert.equal(isBurst(14, { minFiles: 5 }), true);
});

test('a run below the threshold is not a burst', () => {
  assert.equal(isBurst(4, { minFiles: 5 }), false);
  assert.equal(isBurst(0, { minFiles: 5 }), false);
});

test('a non-positive threshold disables burst detection', () => {
  assert.equal(isBurst(100, { minFiles: 0 }), false);
  assert.equal(isBurst(100, { minFiles: -1 }), false);
});

test('burstLabel names the count and pluralizes', () => {
  assert.equal(burstLabel(1), 'auto: 1 file changed');
  assert.equal(burstLabel(14), 'auto: 14 files changed');
});
