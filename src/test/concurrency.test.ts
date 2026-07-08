import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../concurrency';

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

test('returns results in input order regardless of finish order', async () => {
  // Earlier items take longer, so completion order is reversed from input.
  const out = await mapWithConcurrency([30, 20, 10], 3, async (ms, i) => {
    await tick(ms);
    return i;
  });
  assert.deepEqual(out, [0, 1, 2]);
});

test('never exceeds the concurrency limit', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick(2);
    inFlight--;
  });
  assert.ok(peak <= 4, `peak ${peak} should not exceed 4`);
});

test('processes every item exactly once', async () => {
  const seen: number[] = [];
  await mapWithConcurrency([10, 11, 12, 13, 14], 2, async n => {
    seen.push(n);
  });
  assert.deepEqual(seen.sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('handles an empty list and starts no runners', async () => {
  const out = await mapWithConcurrency([], 4, async () => 'x');
  assert.deepEqual(out, []);
});

test('a limit below one is clamped to one', async () => {
  let inFlight = 0;
  let peak = 0;
  await mapWithConcurrency([1, 2, 3], 0, async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await tick(1);
    inFlight--;
  });
  assert.equal(peak, 1);
});

test('a non-finite limit is clamped to one and still processes every item', async () => {
  // NaN once started zero runners and returned an array of holes.
  const out = await mapWithConcurrency([1, 2, 3], NaN, async n => n * 2);
  assert.deepEqual(out, [2, 4, 6]);
});

test('a throwing worker rejects the run', async () => {
  await assert.rejects(
    mapWithConcurrency([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/,
  );
});
