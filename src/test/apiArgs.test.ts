import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabel, isStringArg } from '../apiArgs';

test('normalizeLabel trims a string label', () => {
  assert.equal(normalizeLabel('  before agent  '), 'before agent');
  assert.equal(normalizeLabel('kept'), 'kept');
});

test('normalizeLabel returns empty for whitespace or empty input', () => {
  assert.equal(normalizeLabel(''), '');
  assert.equal(normalizeLabel('   '), '');
});

test('normalizeLabel returns empty for non-string input instead of throwing', () => {
  // An untyped agent could pass any of these; label.trim() would otherwise throw.
  assert.equal(normalizeLabel(undefined), '');
  assert.equal(normalizeLabel(null), '');
  assert.equal(normalizeLabel(42 as unknown), '');
  assert.equal(normalizeLabel({} as unknown), '');
});

test('isStringArg accepts only strings', () => {
  assert.equal(isStringArg('20260615-120000'), true);
  assert.equal(isStringArg(''), true);
  assert.equal(isStringArg(undefined), false);
  assert.equal(isStringArg(null), false);
  assert.equal(isStringArg(123 as unknown), false);
  assert.equal(isStringArg({} as unknown), false);
});
