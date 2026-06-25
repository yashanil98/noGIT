// Assemble the message shown after restoring a whole snapshot. The caller
// passes an already-formatted timestamp so this stays pure and testable.
//
// When some files could not be backed up first, those were skipped rather than
// overwritten (see restoreGate); the message names them and there is nothing
// to undo for the skipped set, so offerUndo is false. Otherwise every captured
// file was restored over a backed-up version, so an undo can be offered.
export interface RestoreSummary {
  message: string;
  offerUndo: boolean;
}

export function buildRestoreSummary(stamp: string, restored: number, skipped: string[]): RestoreSummary {
  if (skipped.length > 0) {
    return {
      message:
        `noGIT: restored ${restored} file(s) from ${stamp}. ` +
        `Skipped ${skipped.length} that could not be backed up first: ${skipped.join(', ')}.`,
      offerUndo: false,
    };
  }
  return {
    message: `noGIT: restored ${restored} file(s) from ${stamp}.`,
    offerUndo: true,
  };
}
