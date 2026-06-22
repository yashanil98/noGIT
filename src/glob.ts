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

// Compiled regexes are cached by pattern text. shouldExclude runs on every
// document and filesystem-watcher event, so on a large workspace the same few
// configured patterns would otherwise be recompiled thousands of times. The
// cache is bounded by the number of distinct patterns a user configures.
const regexCache = new Map<string, RegExp>();

function compile(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) return cached;
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
  const regex = new RegExp(`^${regexBody}$`);
  regexCache.set(pattern, regex);
  return regex;
}

export function globMatch(pattern: string, value: string): boolean {
  return compile(pattern).test(value);
}

// True when a relative path matches any of the given glob patterns.
export function matchesAny(patterns: string[], relPath: string): boolean {
  return patterns.some(p => globMatch(p, relPath));
}
