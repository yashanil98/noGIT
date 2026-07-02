import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../manifest';

test('accepts a well-formed auto-snapshot manifest', () => {
  const m = parseManifest('{"timestamp":"20260615-120000","files":["src/app.ts"]}');
  assert.deepEqual(m, { timestamp: '20260615-120000', files: ['src/app.ts'] });
});

test('accepts a checkpoint manifest with a label and a collision suffix', () => {
  const m = parseManifest('{"timestamp":"20260615-120000-2","files":[],"label":"before agent"}');
  assert.deepEqual(m, { timestamp: '20260615-120000-2', files: [], label: 'before agent' });
});

test('rejects invalid JSON', () => {
  assert.equal(parseManifest('{not json'), undefined);
});

test('rejects a missing or non-array files field', () => {
  assert.equal(parseManifest('{"timestamp":"20260615-120000"}'), undefined);
  assert.equal(parseManifest('{"timestamp":"20260615-120000","files":"nope"}'), undefined);
});

test('rejects non-string entries in files', () => {
  assert.equal(parseManifest('{"timestamp":"20260615-120000","files":["ok",3]}'), undefined);
});

test('rejects a bad timestamp', () => {
  assert.equal(parseManifest('{"timestamp":"nope","files":[]}'), undefined);
});

test('rejects a non-string label', () => {
  assert.equal(parseManifest('{"timestamp":"20260615-120000","files":[],"label":5}'), undefined);
});

test('an empty-string label parses but is not treated as a checkpoint label', () => {
  const m = parseManifest('{"timestamp":"20260615-120000","files":[],"label":""}');
  // An empty label is a valid string, so the manifest parses, but callers
  // checking label.length will not treat it as a named checkpoint.
  assert.deepEqual(m, { timestamp: '20260615-120000', files: [], label: '' });
});

test('accepts an auto burst checkpoint manifest', () => {
  const m = parseManifest('{"timestamp":"20260615-120000","files":["a.ts"],"label":"agent edit","auto":true}');
  assert.deepEqual(m, { timestamp: '20260615-120000', files: ['a.ts'], label: 'agent edit', auto: true });
});

test('drops auto:false rather than carrying it', () => {
  // Only auto:true is meaningful; a false or absent flag means an ordinary
  // snapshot, so the parsed result omits it.
  const m = parseManifest('{"timestamp":"20260615-120000","files":[],"auto":false}');
  assert.deepEqual(m, { timestamp: '20260615-120000', files: [] });
});

test('rejects a non-boolean auto field', () => {
  assert.equal(parseManifest('{"timestamp":"20260615-120000","files":[],"auto":"yes"}'), undefined);
});
