// Decide whether a run of file changes looks like an "agent burst": many files
// changing close together, the signature of an AI agent or a bulk tool writing
// across the workspace rather than a person editing one file at a time.
//
// The decision is pure so it can be unit tested. The manager feeds it the count
// of distinct files changed since the last snapshot and calls it when changes
// have been quiet for the debounce interval; this only judges the threshold.
export interface BurstConfig {
  // Minimum distinct files changed in a run to count as a burst.
  minFiles: number;
}

export function isBurst(changedFileCount: number, config: BurstConfig): boolean {
  return config.minFiles > 0 && changedFileCount >= config.minFiles;
}

// The label put on an automatic burst checkpoint, naming the file count so it
// reads clearly in the timeline (for example "auto: 14 files changed").
export function burstLabel(changedFileCount: number): string {
  const noun = changedFileCount === 1 ? 'file' : 'files';
  return `auto: ${changedFileCount} ${noun} changed`;
}
