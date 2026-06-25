import * as path from 'path';

// Pure path-containment helpers, kept free of any vscode imports so they can
// be unit tested under plain Node.

// Return the workspace-relative posix path for an absolute path, or undefined
// when the path is not inside the workspace root. This is the single guard
// that keeps snapshot and restore operations from escaping the workspace via
// "..", absolute paths, or sibling directories that merely share a name prefix.
export function toWorkspaceRel(root: string, absPath: string): string | undefined {
  const rel = path.relative(root, absPath);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return rel.split(path.sep).join(path.posix.sep);
}

// True when `child` resolves to a location inside `root` (or is root itself).
// Used to confirm a join with caller-supplied path segments did not escape.
export function isInside(root: string, child: string): boolean {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// True when a workspace-relative posix path is the snapshot folder itself or a
// path beneath it. This is the guard that stops noGIT from snapshotting its own
// store (which would loop, since the watcher fires on snapshot writes). The
// trailing-slash check matters: a sibling that merely shares the name prefix,
// such as ".nogitignore" or ".nogitX/file", must not be treated as inside.
export function isWithinSnapshotFolder(rel: string, folderName: string): boolean {
  return rel === folderName || rel.startsWith(`${folderName}/`);
}
