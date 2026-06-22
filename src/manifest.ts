import { SnapshotInfo } from './snapshotManager';

// Parse and validate the raw contents of a snapshot meta.json. Returns the
// manifest only when it has the expected shape, otherwise undefined. A
// snapshot folder can be partially written (interrupted mid-snapshot) or hand
// edited, so a malformed manifest must be skipped rather than trusted: an
// object missing `files` would otherwise reach the timeline UI and throw when
// it maps over the file list, breaking the panel for every snapshot.
export function parseManifest(raw: string): SnapshotInfo | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;

  const obj = value as Record<string, unknown>;
  if (typeof obj.timestamp !== 'string') return undefined;
  if (!/^\d{8}-\d{6}(?:-\d+)?$/.test(obj.timestamp)) return undefined;
  if (!Array.isArray(obj.files) || !obj.files.every(f => typeof f === 'string')) return undefined;
  if (obj.label !== undefined && typeof obj.label !== 'string') return undefined;

  const result: SnapshotInfo = { timestamp: obj.timestamp, files: obj.files as string[] };
  if (typeof obj.label === 'string') result.label = obj.label;
  return result;
}
