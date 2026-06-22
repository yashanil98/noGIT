// Parse a snapshot stamp (YYYYMMDD-HHmmss, optionally with a -N collision
// suffix) into epoch milliseconds in local time. Returns undefined when the
// stamp does not match the expected shape.
export function parseSnapshotStamp(ts: string): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/.exec(ts);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const date = new Date(y, mo - 1, d, h, mi, s);
  return date.getTime();
}

// Render a snapshot stamp as a readable absolute time, "YYYY-MM-DD HH:MM:SS".
// Falls back to the raw stamp when it does not match the expected shape. Any
// collision suffix is dropped since it is not part of the wall-clock time.
export function formatStamp(ts: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/.exec(ts);
  if (!m) return ts;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// Render the gap between a snapshot stamp and now as a short, human label
// such as "just now", "5m ago", "3h ago", or "2d ago". Falls back to the raw
// stamp when it cannot be parsed. `nowMs` is injected so the result is
// deterministic and testable.
export function relativeTime(ts: string, nowMs: number): string {
  const then = parseSnapshotStamp(ts);
  if (then === undefined) return ts;

  const diffSec = Math.round((nowMs - then) / 1000);
  if (diffSec < 0) return 'just now';   // clock skew; do not show a future time
  if (diffSec < 45) return 'just now';

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 14) return `${diffDay}d ago`;

  const diffWeek = Math.round(diffDay / 7);
  return `${diffWeek}w ago`;
}
