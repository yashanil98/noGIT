import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSnapshotsToPrune, SnapshotEntry } from '../prune';

const auto = (name: string): SnapshotEntry => ({ name, isCheckpoint: false });
const cp = (name: string): SnapshotEntry => ({ name, isCheckpoint: true });

test('returns nothing when under or at the limit', () => {
  assert.deepEqual(selectSnapshotsToPrune([auto('20260615-120000')], 3), []);
  assert.deepEqual(
    selectSnapshotsToPrune([auto('20260615-120000'), auto('20260615-120001')], 2),
    []
  );
});

test('prunes the oldest automatic snapshots first when over the limit', () => {
  const entries = [
    auto('20260615-120002'),
    auto('20260615-120000'),
    auto('20260615-120001'),
  ];
  assert.deepEqual(selectSnapshotsToPrune(entries, 1), [
    '20260615-120000',
    '20260615-120001',
  ]);
});

test('never prunes checkpoints even when they are the oldest', () => {
  const entries = [
    cp('20260615-110000'),
    auto('20260615-120000'),
    auto('20260615-120001'),
  ];
  // max=1: only the two auto snapshots count, so the oldest auto is pruned and
  // the checkpoint is left alone.
  assert.deepEqual(selectSnapshotsToPrune(entries, 1), ['20260615-120000']);
});

test('interleaved checkpoints do not shift the auto cut', () => {
  const entries = [
    auto('20260615-120000'),
    cp('20260615-120001'),
    auto('20260615-120002'),
    auto('20260615-120003'),
  ];
  // Three auto snapshots, max=2, so only the oldest auto is pruned.
  assert.deepEqual(selectSnapshotsToPrune(entries, 2), ['20260615-120000']);
});

test('collision-suffixed names sort right after their base', () => {
  const entries = [
    auto('20260615-120000'),
    auto('20260615-120000-2'),
    auto('20260615-120001'),
  ];
  assert.deepEqual(selectSnapshotsToPrune(entries, 1), [
    '20260615-120000',
    '20260615-120000-2',
  ]);
});

test('max of 1 with one checkpoint and several auto keeps one auto', () => {
  const entries = [
    cp('20260615-100000'),
    auto('20260615-120000'),
    auto('20260615-120001'),
    auto('20260615-120002'),
  ];
  assert.deepEqual(selectSnapshotsToPrune(entries, 1), [
    '20260615-120000',
    '20260615-120001',
  ]);
});
