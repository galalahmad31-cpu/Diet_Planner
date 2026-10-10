import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await walk(join(directory, entry.name));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(join(directory, entry.name));
    }
  }
}

await walk('.');
let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`\n✗ ${file}\n${result.stderr || result.stdout}`);
  }
}
if (failed) process.exit(1);
process.stdout.write(`JavaScript syntax check passed for ${files.length} files.\n`);
