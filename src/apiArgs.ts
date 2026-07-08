// Runtime argument guards for the public API. NoGitApi is documented for AI
// coding agents and other tools, i.e. untyped JS callers that can violate the
// TypeScript signatures at runtime. The webview message boundary already
// validates its inputs; these keep the programmatic API just as forgiving, so a
// mis-typed call is a clean no-op (return 0/false/undefined) instead of an
// unhandled exception from label.trim() or path.join() on a non-string.

// A checkpoint label trimmed of surrounding whitespace, or '' when the value is
// not a usable string. An empty result means "not a valid checkpoint label",
// which callers already treat as a no-op.
export function normalizeLabel(label: unknown): string {
  return typeof label === 'string' ? label.trim() : '';
}

// True when a value is usable as a path or timestamp string argument.
export function isStringArg(v: unknown): v is string {
  return typeof v === 'string';
}
