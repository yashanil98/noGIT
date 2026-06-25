import * as path from 'path';
import * as fs from 'fs/promises';
import { isInside } from './paths';

// Symlink-aware containment check. The lexical isInside guard in paths.ts can
// be fooled by a symlinked path component: a path that is lexically inside the
// root can still resolve, through a link, to a location outside it. That
// matters here because noGIT targets the AI-agent threat model, where a
// workspace or the snapshot store may contain attacker-planted symlinks.
//
// Resolve the real location of `target` and confirm it stays inside the real
// `root`. Because `target` may not exist yet (a restore creates new files), we
// resolve the nearest existing ancestor and append the not-yet-created tail.
// Returns false on any error, so an unresolvable path is refused rather than
// allowed.
export async function isRealPathInside(root: string, target: string): Promise<boolean> {
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch {
    return false;
  }

  // Walk up until we find an ancestor that exists on disk, collecting the
  // not-yet-created trailing segments.
  let current = path.resolve(target);
  const tail: string[] = [];
  // Stop if we walk past the filesystem root (dirname of root is itself).
  for (let guard = 0; guard < 4096; guard++) {
    try {
      const real = await fs.realpath(current);
      const full = tail.length ? path.join(real, ...tail) : real;
      return isInside(realRoot, full);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return false; // reached filesystem root, nothing resolved
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
  return false;
}
