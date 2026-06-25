import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusBarLabel } from '../statusLabel';

test('shows the history codicon and relative time when a snapshot exists', () => {
  const { text, tooltip } = statusBarLabel('5m ago');
  assert.equal(text, '$(history) noGIT: 5m ago');
  assert.ok(tooltip.startsWith('Last snapshot 5m ago.'));
  assert.ok(tooltip.includes('Click to open the timeline.'));
});

test('falls back to a plain label and prompt when there is no snapshot yet', () => {
  const { text, tooltip } = statusBarLabel(undefined);
  assert.equal(text, '$(history) noGIT');
  assert.equal(tooltip, 'noGIT: no snapshots yet. Click to open the timeline.');
});
