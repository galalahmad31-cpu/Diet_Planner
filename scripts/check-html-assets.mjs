#!/usr/bin/env node
/**
 * Validate local JavaScript and stylesheet references in root HTML pages.
 * This catches stale paths when a feature controller is reorganized.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlFiles = fs.readdirSync(root, { withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
  .map(entry => path.join(root, entry.name));

const errors = [];

function checkReference(htmlFile, rawReference, kind) {
  const reference = rawReference.trim().split(/[?#]/, 1)[0];
  if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(reference)) return;
  if (kind === 'script' && !/\.m?js$/i.test(reference)) return;
  if (kind === 'stylesheet' && !/\.css$/i.test(reference)) return;

  let decoded;
  try {
    decoded = decodeURIComponent(reference);
  } catch {
    errors.push(`${path.basename(htmlFile)}: invalid encoded ${kind} path "${rawReference}"`);
    return;
  }

  const absolute = path.resolve(root, decoded.replace(/^\.\//, ''));
  if (!absolute.startsWith(root + path.sep)) {
    errors.push(`${path.basename(htmlFile)}: ${kind} path escapes repository root "${rawReference}"`);
    return;
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    errors.push(`${path.basename(htmlFile)}: missing ${kind} "${rawReference}"`);
  }
}

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  for (const match of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    checkReference(htmlFile, match[1], 'script');
  }
  for (const match of html.matchAll(/<link\b([^>]+)>/gi)) {
    const attributes = match[1];
    if (!/\brel\s*=\s*["'][^"']*\bstylesheet\b[^"']*["']/i.test(attributes)) continue;
    const href = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (href) checkReference(htmlFile, href[1], 'stylesheet');
  }
}

if (errors.length) {
  console.error('Local frontend asset check failed:');
  errors.forEach(error => console.error(` - ${error}`));
  process.exitCode = 1;
} else {
  console.log(`Local frontend asset check passed (${htmlFiles.length} HTML pages checked).`);
}
