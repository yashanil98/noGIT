import * as path from 'path';

// Pure path-containment helpers, kept free of any vscode imports so they can
// be unit tested under plain Node.

// A relative path escapes `root` only when it is exactly ".." or begins with a
// ".." path segment (".." followed by a separator), or is absolute. A bare
// startsWith('..') check is wrong: it also rejects legitimate filenames that
// merely begin with two dots, such as "..doubledot.txt" or "...tripledot",
// which stay inside the root -- silently dropping them from snapshots. A sibling
// that shares the root's name prefix (e.g. "proj-evil") still yields a "../"
// relative path and is correctly rejected.
function escapesRoot(rel: string): boolean {
  return rel === '..' || rel.startsWith('..' + path.sep) || rel.startsWith('../') || path.isAbsolute(rel);
}

// Return the workspace-relative posix path for an absolute path, or undefined
// when the path is not inside the workspace root. This is the single guard
// that keeps snapshot and restore operations from escaping the workspace via
// "..", absolute paths, or sibling directories that merely share a name prefix.
export function toWorkspaceRel(root: string, absPath: string): string | undefined {
  const rel = path.relative(root, absPath);
  if (rel === '' || escapesRoot(rel)) return undefined;
  return rel.split(path.sep).join(path.posix.sep);
}

// True when `child` resolves to a location inside `root` (or is root itself).
// Used to confirm a join with caller-supplied path segments did not escape.
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || !escapesRoot(rel);
}

// True when a workspace-relative posix path is the snapshot folder itself or a
// path beneath it. This is the guard that stops noGIT from snapshotting its own
// store (which would loop, since the watcher fires on snapshot writes). The
// trailing-slash check matters: a sibling that merely shares the name prefix,
// such as ".nogitignore" or ".nogitX/file", must not be treated as inside.
export function isWithinSnapshotFolder(rel: string, folderName: string): boolean {
  return rel === folderName || rel.startsWith(`${folderName}/`);
}
