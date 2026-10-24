import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
test('GitHub Pages loads all local scripts, styles and icons without CDN or PHP', async () => {
  const paths = [...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map(m => m[1]);
  for (const file of paths) await access(new URL(file, root));
  assert(!html.includes('<?php'));
  assert(!/<script[^>]+src="https?:/i.test(html));
});
test('original CSS including iframe crop is preserved byte for byte', async () => {
  const css = await readFile(new URL('itsatv.css', root));
  assert.equal(createHash('sha256').update(css).digest('hex'), 'cfb7cc6a356bedfad814acebd22765819a21435bb29f6aafb96c121f43d7293e');
});
test('no duplicate IDs or third-party tracking integrations in HTML', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert(!/sentry|googletagmanager|firebase|vk\.com|cookiebanner/i.test(html));
});
