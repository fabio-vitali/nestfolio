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

/**
 * Post-process C2 layer SVGs to add:
 *  - Inner padding (shrink the background rect)
 *  - Title above the box (insert SVG text element)
 *  - Expand viewBox to fit title + padding
 *
 * D2 layers don't support inner padding or external labels, so we patch the SVG.
 */
function patchC2Layers(dir) {
  const PAD = 60;       // inner margin between box border and content
  const TITLE_GAP = 70; // space for the title above the box
  let count = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('c2-')) continue;
    const svgPath = join(dir, entry.name, 'index.svg');
    let svg;
    try { svg = readFileSync(svgPath, 'utf-8'); } catch { continue; }

    const domain = entry.name.replace('c2-', '');
    const title = domain.charAt(0).toUpperCase() + domain.slice(1) + ' Domain';

    // Match the background rect: first <rect .../> in the SVG
    const bgMatch = svg.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)" rx="([^"]+)" ([^/]*)\/>/);
    if (!bgMatch) continue;
    const [fullRect, bx, by, bw, bh, brx, bAttrs] = bgMatch;
    const rx = Number(bx), ry = Number(by), rw = Number(bw), rh = Number(bh);

    // Shrink the background rect by PAD on each side
    const newRx = rx + PAD, newRy = ry + PAD;
    const newRw = rw - 2 * PAD, newRh = rh - 2 * PAD;
    const newRect = `<rect x="${newRx}" y="${newRy}" width="${newRw}" height="${newRh}" rx="${brx}" ${bAttrs}/>`;

    // Title text above the box
    const titleX = newRx;
    const titleY = newRy - 16;
    const titleEl = `<text x="${titleX}" y="${titleY}" font-family="Source Sans Pro, sans-serif" font-size="48" font-weight="700" fill="#000000">${title}</text>`;

    svg = svg.replace(fullRect, newRect + titleEl);

    // Expand outer SVG viewBox to fit title
    svg = svg.replace(
      /(preserveAspectRatio="[^"]*" viewBox=")([^"]+)(")/,
      (_, pre, vb, post) => {
        const [ox, oy, ow, oh] = vb.split(/\s+/).map(Number);
        return `${pre}${ox} ${oy - TITLE_GAP} ${ow} ${oh + TITLE_GAP}${post}`;
      },
    );
    // Update outer SVG width/height attributes
    svg = svg.replace(
      /(<svg[^>]*) width="(\d+)" height="(\d+)"/,
      (m, pre, w, h) => `${pre} width="${w}" height="${Number(h) + TITLE_GAP}"`,
    );
    // Update inner SVG height
    svg = svg.replace(
      /(<svg class="[^"]*d2-svg[^"]*") width="(\d+)" height="(\d+)"/,
      (m, pre, w, h) => `${pre} width="${w}" height="${Number(h) + TITLE_GAP}"`,
    );

    writeFileSync(svgPath, svg);
    count++;
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
  execSync(`${d2} --layout elk --elk-padding "[top=120,left=100,bottom=100,right=100]" --elk-nodeNodeBetweenLayers 100 --pad 80 "${D2_SOURCE}" "${OUT_DIR}/"`, {
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

// Post-process C2 SVGs: add title + inner padding (D2 layers don't support these)
const c2Patched = patchC2Layers(OUT_DIR);
console.log(`  c2-patched: ${c2Patched} files (title + margins)`);

console.log('Done.');
