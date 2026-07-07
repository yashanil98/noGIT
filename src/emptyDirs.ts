// After an exact restore deletes files, the directories that held them can be
// left empty, so the workspace is not truly returned to the checkpoint. This
// computes which directories to try removing, and in what order.
//
// Given the workspace-relative posix paths that were deleted, return every
// ancestor directory of those files, deepest first, with no duplicates. The
// caller attempts to remove each in turn and skips any that is not actually
// empty, so a deepest-first order means a child directory is cleared before its
// parent is considered. The workspace root (empty string) is never included.
export function emptyDirCandidates(deletedRels: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const rel of deletedRels) {
    let dir = parentPosix(rel);
    while (dir !== '') {
      dirs.add(dir);
      dir = parentPosix(dir);
    }
  }
  // Deepest first: more path segments sorts earlier. Ties broken lexically for
  // a stable, deterministic order.
  return [...dirs].sort((a, b) => {
    const depth = segmentCount(b) - segmentCount(a);
    return depth !== 0 ? depth : (a < b ? -1 : a > b ? 1 : 0);
  });
}

function parentPosix(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function segmentCount(p: string): number {
  return p.length === 0 ? 0 : p.split('/').length;
}
