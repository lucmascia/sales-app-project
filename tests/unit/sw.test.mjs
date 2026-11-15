import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [relative(APP, path)];
});

test('every file of the app is in the offline cache list', () => {
  const source = readFileSync(join(APP, 'sw.js'), 'utf8');
  const shell = [...source.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = walk(APP).filter((f) => f !== 'sw.js');
  assert.deepEqual(files.filter((f) => !shell.includes(f)), [], 'files missing from SHELL in sw.js');
  assert.deepEqual(shell.filter((f) => f !== './' && !files.includes(f)), [], 'SHELL entries with no file');
});
