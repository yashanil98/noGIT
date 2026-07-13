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

// At most this many skipped file names are spelled out in the message; the rest
// are summarized as a count, so a restore that skips hundreds of files does not
// produce an unreadable wall of text in a notification.
const MAX_LISTED_SKIPPED = 10;

export function buildRestoreSummary(stamp: string, restored: number, skipped: string[]): RestoreSummary {
  if (skipped.length > 0) {
    const listed = skipped.slice(0, MAX_LISTED_SKIPPED).join(', ');
    const overflow = skipped.length - MAX_LISTED_SKIPPED;
    const names = overflow > 0 ? `${listed}, and ${overflow} more` : listed;
    return {
      message:
        `noGIT: restored ${restored} file(s) from ${stamp}. ` +
        `Skipped ${skipped.length} that could not be backed up first: ${names}.`,
      offerUndo: false,
    };
  }
  return {
    message: `noGIT: restored ${restored} file(s) from ${stamp}.`,
    offerUndo: true,
  };
}
