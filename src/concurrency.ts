// Run an async worker over items with a bounded number in flight at once, so a
// large workspace snapshot does not open thousands of file handles at the same
// time (which can exhaust descriptors) while still being much faster than a
// fully serial loop. Results are returned in input order regardless of the
// order tasks finish. A worker that throws rejects the whole run, matching
// Promise.all semantics; callers that want per-item tolerance should catch
// inside the worker.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  // Clamp to at least one runner. A non-finite limit (NaN) would otherwise
  // start zero runners and return an array of holes, silently processing
  // nothing, so treat it like any other out-of-range value.
  const effectiveLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  let next = 0;

  async function runner(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }

  const runners = Array.from(
    { length: Math.min(effectiveLimit, items.length) },
    () => runner(),
  );
  await Promise.all(runners);
  return results;
}
