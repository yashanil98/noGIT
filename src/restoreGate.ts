// Restoring a file overwrites whatever is currently on disk. noGIT first takes
// a backup snapshot so a restore is itself undoable, but that backup can fail
// to capture a file (locked, unreadable, or over the size cap). In that case
// overwriting would destroy a version that cannot be recovered.
//
// A restore is safe only when there is nothing to lose (the file does not
// currently exist) or the current contents were captured in the backup.
export function canRestoreSafely(fileExists: boolean, wasBackedUp: boolean): boolean {
  return !fileExists || wasBackedUp;
}
