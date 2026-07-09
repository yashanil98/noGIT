// noGIT snapshots a single workspace folder: the first one (workspaceFolders[0]).
// That binding is chosen once, but the workspace folder set can change while the
// window is open (a folder opened into an empty window, or a root added, removed,
// or reordered in a multi-root workspace). When it does, the manager must decide
// what to do, and getting this wrong means snapshotting into a folder that is no
// longer part of the workspace. This pure decision is kept separate from the
// vscode-coupled manager so it can be unit tested.
//
// Given the path of the folder currently bound (undefined when none is) and the
// path of the current first workspace folder (undefined when the window has no
// folders), return the action the manager should take.
export type FolderAction =
  | 'none' // the bound folder is still the first folder; nothing to do
  | 'bind' // nothing was bound and a first folder now exists; start on it
  | 'rebind' // a different folder is now first; switch to it
  | 'unbind'; // the window no longer has any folder; stop

export function decideFolderTransition(
  current: string | undefined,
  firstFolder: string | undefined,
): FolderAction {
  if (current === firstFolder) return 'none'; // also covers both undefined
  if (current === undefined) return 'bind';
  if (firstFolder === undefined) return 'unbind';
  return 'rebind';
}
