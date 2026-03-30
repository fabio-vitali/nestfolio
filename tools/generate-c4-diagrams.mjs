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
 * Title sizing constants.
 * Font ascent (~0.75 * fontSize) determines how far above the baseline the text extends.
 * TITLE_GAP must be large enough to contain the full ascent + a top margin.
 */
const TITLE_FONT_SIZE = 48;
const TITLE_ASCENT = Math.ceil(TITLE_FONT_SIZE * 0.75); // ~36px
const TITLE_TOP_MARGIN = 24;
const TITLE_GAP = TITLE_ASCENT + TITLE_TOP_MARGIN + 16; // 76px — shared by C1 and C2
const BOTTOM_PAD = 10; // D2 layers lack consistent bottom padding — add explicitly

/**
 * Insert a title into an SVG and expand both viewBoxes to fit it.
 *
 * The inner SVG viewBox is expanded upward (new coordinate space for the title).
 * The inner SVG physical height grows to match.
 * The outer SVG viewBox height grows to show the taller inner SVG — its origin
 * stays fixed so the original bottom padding is preserved.
 */
function insertSvgTitle(svg, title) {
  // Parse inner SVG viewBox for title positioning
  const innerVbMatch = svg.match(/<svg class="[^"]*d2-svg[^"]*"[^>]*viewBox="([^"]+)"/);
  if (!innerVbMatch) return null;
  const [ix, iy] = innerVbMatch[1].split(/\s+/).map(Number);

  // Place baseline so the full ascent + margin fits within the expanded viewBox
  // New inner viewBox top = iy - TITLE_GAP, baseline = newTop + margin + ascent
  const titleX = ix + 10;
  const titleY = (iy - TITLE_GAP) + TITLE_TOP_MARGIN + TITLE_ASCENT;
  const titleEl = `<text x="${titleX}" y="${titleY}" font-family="Source Sans Pro, sans-serif" font-size="${TITLE_FONT_SIZE}" font-weight="700" fill="#000000">${title}</text>`;

  // Insert after last </style> closing tag (within inner SVG, before content)
  const lastStyleEnd = svg.lastIndexOf(']]></style>');
  if (lastStyleEnd === -1) return null;
  const insertIdx = lastStyleEnd + 11; // right after </style>
  svg = svg.slice(0, insertIdx) + titleEl + svg.slice(insertIdx);

  const totalExpand = TITLE_GAP + BOTTOM_PAD;

  // Expand inner SVG viewBox: upward for title, downward for bottom padding
  svg = svg.replace(
    /(<svg class="[^"]*d2-svg[^"]*") width="(\d+)" height="(\d+)" viewBox="([^"]+)"/,
    (m, pre, w, h, vb) => {
      const [vx, vy, vw, vh] = vb.split(/\s+/).map(Number);
      return `${pre} width="${w}" height="${Number(h) + totalExpand}" viewBox="${vx} ${vy - TITLE_GAP} ${vw} ${vh + totalExpand}"`;
    },
  );

  // Expand outer SVG viewBox height (origin stays fixed → bottom padding preserved)
  svg = svg.replace(
    /(preserveAspectRatio="[^"]*" viewBox=")([^"]+)(")/,
    (_, pre, vb, post) => {
      const [ox, oy, ow, oh] = vb.split(/\s+/).map(Number);
      return `${pre}${ox} ${oy} ${ow} ${oh + totalExpand}${post}`;
    },
  );

  return svg;
}

/**
 * Post-process C1 root SVG to add title "Nestfolio System" above the content.
 */
function patchC1Layer(dir) {
  const svgPath = join(dir, 'index.svg');
  let svg;
  try { svg = readFileSync(svgPath, 'utf-8'); } catch { return 0; }

  const result = insertSvgTitle(svg, 'Nestfolio System');
  if (!result) return 0;
  writeFileSync(svgPath, result);
  return 1;
}

/**
 * Post-process C2 layer SVGs to add domain titles and expand viewBox.
 */
function patchC2Layers(dir) {
  let count = 0;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('c2-')) continue;
    const svgPath = join(dir, entry.name, 'index.svg');
    let svg;
    try { svg = readFileSync(svgPath, 'utf-8'); } catch { continue; }

    const domain = entry.name.replace('c2-', '');
    const title = domain.charAt(0).toUpperCase() + domain.slice(1) + ' Domain';

    const result = insertSvgTitle(svg, title);
    if (!result) continue;
    writeFileSync(svgPath, result);
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
  execSync(`${d2} --layout elk --elk-padding "[top=40,left=40,bottom=40,right=40]" --elk-nodeNodeBetweenLayers 40 --pad 60 "${D2_SOURCE}" "${OUT_DIR}/"`, {
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

// Post-process C1 SVG: add "Nestfolio System" title
const c1Patched = patchC1Layer(OUT_DIR);
console.log(`  c1-patched: ${c1Patched} files (title)`);

// Post-process C2 SVGs: add domain titles
const c2Patched = patchC2Layers(OUT_DIR);
console.log(`  c2-patched: ${c2Patched} files (title)`);

console.log('Done.');
