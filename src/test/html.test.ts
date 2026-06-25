import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../html';

test('escapes the angle brackets and quotes that could break out of markup', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('replaces the ampersand first so entities are not double-escaped', () => {
  // If "&" were escaped after "<", the "&lt;" it produced would become
  // "&amp;lt;". Ampersand-first keeps each special character escaped once.
  assert.equal(escapeHtml('a & <b>'), 'a &amp; &lt;b&gt;');
});

test('leaves an ordinary file path unchanged', () => {
  assert.equal(escapeHtml('src/app.ts'), 'src/app.ts');
});
