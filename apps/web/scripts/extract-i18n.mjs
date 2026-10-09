#!/usr/bin/env node
/**
 * Extracts t('key', 'Default text') calls from src/ and writes src/locales/en.json.
 * Fails (exit 1) when the same key is used with two different default texts.
 *   node scripts/extract-i18n.mjs          → writes en.json
 *   node scripts/extract-i18n.mjs --check  → verifies en.json is up to date (used by tests/CI)
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const out = join(srcDir, 'locales', 'en.json');

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(tsx?|ts)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx')) files.push(path);
  }
})(srcDir);

// t('key', 'default') / t("key", "default") / t('key', `default`) — default may contain escaped quotes.
const pattern = /\bt\(\s*(['"])([a-zA-Z0-9_.-]+)\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
const messages = {};
const conflicts = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(pattern)) {
    const key = match[2];
    const text = match[4].replace(/\\(['"`\\])/g, '$1');
    if (messages[key] !== undefined && messages[key] !== text) conflicts.push(`${key}: "${messages[key]}" vs "${text}" (${file})`);
    messages[key] ??= text;
  }
}
if (conflicts.length) {
  console.error('Conflicting default texts:\n' + conflicts.join('\n'));
  process.exit(1);
}

// Nest "a.b.c" keys into objects.
const nested = {};
for (const key of Object.keys(messages).sort()) {
  const parts = key.split('.');
  let node = nested;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = messages[key];
}
const json = JSON.stringify(nested, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = readFileSync(out, 'utf8');
  if (current !== json) {
    console.error('src/locales/en.json is out of date. Run: npm run i18n:extract');
    process.exit(1);
  }
  console.log(`en.json up to date (${Object.keys(messages).length} keys)`);
} else {
  writeFileSync(out, json);
  console.log(`Wrote ${Object.keys(messages).length} keys to src/locales/en.json`);
}
