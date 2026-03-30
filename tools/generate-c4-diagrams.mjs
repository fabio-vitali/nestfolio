#!/usr/bin/env node

/**
 * Generates SVG diagrams from the D2 C4 architecture source.
 *
 * Usage:
 *   node tools/generate-c4-diagrams.mjs          # full render (all layers)
 *   node tools/generate-c4-diagrams.mjs --check   # verify d2 is installed and source exists
 *
 * Requires: d2 CLI (https://d2lang.com)
 */

import { execSync } from 'node:child_process';
import { readdirSync, statSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const ARCH_DIR = join(ROOT, 'docs', 'architecture');
const D2_SOURCE = join(ARCH_DIR, 'nestfolio.d2');
const OUT_DIR = join(ARCH_DIR, 'nestfolio');

// ── Helpers ──────────────────────────────────────────────────────────────────

function findD2() {
  const candidates = [
    '/opt/homebrew/bin/d2',
    '/usr/local/bin/d2',
  ];
  for (const p of candidates) {
    try { statSync(p); return p; } catch { /* skip */ }
  }
  // Fall back to PATH
  try {
    return execSync('which d2', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function addSvgExtensions(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += addSvgExtensions(fullPath);
    } else if (!extname(entry.name)) {
      // Extensionless file — check if it's an SVG
      const head = readFileSync(fullPath, 'utf-8').slice(0, 200);
      if (head.includes('<svg') || head.includes('<?xml')) {
        renameSync(fullPath, `${fullPath}.svg`);
        count++;
      }
    }
  }
  return count;
}

function patchNavigationLinks(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += patchNavigationLinks(fullPath);
    } else if (entry.name.endsWith('.svg')) {
      const content = readFileSync(fullPath, 'utf-8');
      // Only patch navigation hrefs (c2-*/c3-* references), never base64 data URIs
      const patched = content.replace(/href="(c[23]-[^"]+?)(?<!\.svg)"/g, 'href="$1.svg"');
      if (patched !== content) {
        writeFileSync(fullPath, patched);
        count++;
      }
    }
  }
  return count;
}

// ── Main ─────────────────────────────────────────────────────────────────────

const flag = process.argv[2];
const d2 = findD2();

if (!d2) {
  console.error('ERROR: d2 CLI not found. Install with: brew install d2');
  process.exit(1);
}

if (flag === '--check') {
  try { statSync(D2_SOURCE); } catch {
    console.error(`ERROR: D2 source not found: ${D2_SOURCE}`);
    process.exit(1);
  }
  console.log(`OK: d2=${d2}, source=${D2_SOURCE}`);
  process.exit(0);
}

console.log(`Rendering D2 → SVG...`);
console.log(`  source: ${D2_SOURCE}`);
console.log(`  output: ${OUT_DIR}/`);

try {
  execSync(`${d2} --layout elk --elk-padding "[top=60,left=60,bottom=60,right=60]" --pad 80 "${D2_SOURCE}" "${OUT_DIR}/"`, {
    cwd: ARCH_DIR,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
} catch (err) {
  console.error('D2 compilation failed:');
  console.error(err.stderr || err.message);
  process.exit(1);
}

// D2 outputs extensionless files when targeting a directory — add .svg
const renamed = addSvgExtensions(OUT_DIR);
console.log(`  renamed: ${renamed} files → .svg`);

// Patch navigation hrefs to include .svg extension (d2 emits bare layer names)
const patched = patchNavigationLinks(OUT_DIR);
console.log(`  patched: ${patched} files (navigation links → .svg)`);

console.log('Done.');
