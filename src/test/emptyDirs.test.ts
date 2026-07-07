import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyDirCandidates } from '../emptyDirs';

test('returns each ancestor directory deepest first', () => {
  assert.deepEqual(emptyDirCandidates(['a/b/c.ts']), ['a/b', 'a']);
});

test('files at the workspace root contribute no directories', () => {
  assert.deepEqual(emptyDirCandidates(['top.ts']), []);
});

test('deduplicates shared ancestors across several files', () => {
  const out = emptyDirCandidates(['a/b/one.ts', 'a/b/two.ts', 'a/c/three.ts']);
  // a/b and a/c are depth 2 (sorted lexically), a is depth 1 and comes last.
  assert.deepEqual(out, ['a/b', 'a/c', 'a']);
});

test('a child directory always sorts before its parent', () => {
  const out = emptyDirCandidates(['x/y/z/deep.ts']);
  assert.deepEqual(out, ['x/y/z', 'x/y', 'x']);
  // Every directory precedes its own parent, so children are cleared first.
  for (let i = 0; i < out.length; i++) {
    const parent = out[i].split('/').slice(0, -1).join('/');
    if (parent) assert.ok(out.indexOf(parent) > i, `${parent} should come after ${out[i]}`);
  }
});

test('handles an empty input', () => {
  assert.deepEqual(emptyDirCandidates([]), []);
});
