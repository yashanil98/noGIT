// Escape a string for safe interpolation into HTML text or a double or single
// quoted attribute. The ampersand must be replaced first so the entities
// introduced by the later replacements are not themselves re-escaped.
//
// This is the single boundary protecting the timeline webview from injection
// through file paths and checkpoint labels, both of which are user controlled.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
