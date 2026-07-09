// When a snapshot claims a batch of pending files (removing them from the
// modified set before an async write), any file the write did not actually
// capture must be put back so it is retried on the next snapshot. A file can
// fail to copy for benign reasons (a transient read error, the size cap, a
// symlink) and must not be silently dropped from tracking.
//
// Given the files that were claimed and the files actually captured, return the
// claimed files that were NOT captured and so should be re-marked as pending.
// Pure set difference, kept here so the tracking-retry rule can be unit tested.
export function uncapturedFiles(claimed: readonly string[], captured: readonly string[]): string[] {
  const done = new Set(captured);
  return claimed.filter(rel => !done.has(rel));
}
