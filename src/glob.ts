// Pure path-matching helpers, kept free of any vscode imports so they can be
// unit tested under plain Node.

// Minimal glob matcher supporting * and **. Sufficient for the
// directory-style patterns exposed in nogit.excludePatterns.
//
//   **/   any number of leading directories, including none
//   **    anything, across path separators
//   *     anything within a single path segment
//
// Paths are expected in posix form (forward slashes).
export function globMatch(pattern: string, value: string): boolean {
  // Walk the pattern left to right, translating each token to a regex
  // fragment. Tokenizing in one pass keeps wildcard fragments and escaped
  // literal text from interfering with one another.
  let regexBody = '';
  for (let i = 0; i < pattern.length; ) {
    if (pattern.startsWith('**/', i)) {
      regexBody += '(?:.*/)?';
      i += 3;
    } else if (pattern.startsWith('**', i)) {
      regexBody += '.*';
      i += 2;
    } else if (pattern[i] === '*') {
      regexBody += '[^/]*';
      i += 1;
    } else {
      regexBody += pattern[i].replace(/[.+^${}()|[\]\\]/, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${regexBody}$`).test(value);
}

// True when a relative path matches any of the given glob patterns.
export function matchesAny(patterns: string[], relPath: string): boolean {
  return patterns.some(p => globMatch(p, relPath));
}
