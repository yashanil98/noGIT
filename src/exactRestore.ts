// An exact (hard) restore of a checkpoint returns the workspace to precisely
// that checkpoint: files it captured are restored, and files created since are
// deleted. This computes which files the delete step must remove.
//
// The delete set is derived from the CURRENT workspace listing, never from the
// checkpoint manifest, so a hand-edited manifest can never widen what gets
// deleted. A file is deleted only when it exists in the workspace now and was
// not part of the checkpoint.
export function filesToDeleteForExactRestore(
  currentFiles: readonly string[],
  checkpointFiles: readonly string[],
): string[] {
  const kept = new Set(checkpointFiles);
  return currentFiles.filter(rel => !kept.has(rel));
}
