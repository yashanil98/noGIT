// Assemble the status bar item's text and tooltip. `when` is the relative time
// since the last snapshot (for example "5m ago"), or undefined when no snapshot
// has been taken yet. Kept pure so the exact wording and the $(history) codicon
// can be tested without a StatusBarItem.
export interface StatusLabel {
  text: string;
  tooltip: string;
}

export function statusBarLabel(when: string | undefined): StatusLabel {
  if (when) {
    return {
      text: `$(history) noGIT: ${when}`,
      tooltip: `Last snapshot ${when}. Click to open the timeline.`,
    };
  }
  return {
    text: '$(history) noGIT',
    tooltip: 'noGIT: no snapshots yet. Click to open the timeline.',
  };
}
