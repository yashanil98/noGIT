import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SerialQueue } from '../serialQueue';

const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

test('tasks run one at a time even when submitted without awaiting', async () => {
  const q = new SerialQueue();
  const events: string[] = [];
  // The first task is slower than the second. If they overlapped, the second
  // would enter before the first finished. Serialization forces order.
  const a = q.run(async () => { events.push('a-start'); await tick(20); events.push('a-end'); });
  const b = q.run(async () => { events.push('b-start'); await tick(1); events.push('b-end'); });
  await Promise.all([a, b]);
  assert.deepEqual(events, ['a-start', 'a-end', 'b-start', 'b-end']);
});

test('a rejected task does not poison the chain', async () => {
  const q = new SerialQueue();
  const failed = q.run(async () => { throw new Error('boom'); });
  await assert.rejects(failed, /boom/);
  const after = await q.run(async () => 'ok');
  assert.equal(after, 'ok');
});

test('returns each task own settled value', async () => {
  const q = new SerialQueue();
  const one = await q.run(async () => 1);
  const two = await q.run(async () => 2);
  assert.equal(one, 1);
  assert.equal(two, 2);
});
