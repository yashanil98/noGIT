import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globMatch, matchesAny } from '../glob';

const DEFAULT_EXCLUDES = [
  '**/.git/**',
  '**/.nogit/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/out/**',
];

test('** matches across path separators including the leading directory', () => {
  assert.equal(globMatch('**/node_modules/**', 'node_modules/foo/bar.js'), true);
  assert.equal(globMatch('**/node_modules/**', 'src/node_modules/x.js'), true);
  assert.equal(globMatch('**/.git/**', '.git/config'), true);
  assert.equal(globMatch('**/.nogit/**', '.nogit/snapshots/x'), true);
});

test('* stays within a single path segment', () => {
  assert.equal(globMatch('**/*.log', 'logs/debug.log'), true);
  assert.equal(globMatch('*.log', 'debug.log'), true);
  assert.equal(globMatch('*.log', 'nested/debug.log'), false);
});

test('a trailing /** matches everything under a prefix', () => {
  assert.equal(globMatch('src/**', 'src/deep/app.ts'), true);
  assert.equal(globMatch('src/**', 'lib/app.ts'), false);
});

test('non-matching paths are rejected', () => {
  assert.equal(globMatch('**/node_modules/**', 'src/app.ts'), false);
  assert.equal(globMatch('**/.git/**', 'src/app.ts'), false);
});

test('dots in the pattern are treated as literals', () => {
  assert.equal(globMatch('**/.nogit/**', 'Xnogit/x'), false);
  assert.equal(globMatch('a.b', 'a.b'), true);
  assert.equal(globMatch('a.b', 'axb'), false);
});

test('a question mark is a literal, not a regex quantifier', () => {
  // Only * and ** are wildcards, so ? must match a literal ? and nothing else.
  assert.equal(globMatch('a?b', 'a?b'), true);
  assert.equal(globMatch('a?b', 'ab'), false);
  assert.equal(globMatch('**/temp?/**', 'temp?/notes.txt'), true);
  assert.equal(globMatch('**/temp?/**', 'temp/notes.txt'), false);
});

test('repeated calls with the same pattern stay correct (cached regex is reused)', () => {
  // The compiled regex is cached by pattern text. A cached RegExp with a
  // global flag would carry lastIndex between calls; assert that does not
  // happen by matching and not-matching the same pattern several times.
  for (let i = 0; i < 3; i++) {
    assert.equal(globMatch('**/node_modules/**', 'node_modules/a.js'), true);
    assert.equal(globMatch('**/node_modules/**', 'src/app.ts'), false);
  }
});

test('matchesAny applies the default exclude set', () => {
  assert.equal(matchesAny(DEFAULT_EXCLUDES, 'node_modules/react/index.js'), true);
  assert.equal(matchesAny(DEFAULT_EXCLUDES, 'dist/extension.js'), true);
  assert.equal(matchesAny(DEFAULT_EXCLUDES, 'out/x.js'), true);
  assert.equal(matchesAny(DEFAULT_EXCLUDES, 'src/snapshotManager.ts'), false);
});
