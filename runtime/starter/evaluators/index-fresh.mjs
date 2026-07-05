#!/usr/bin/env node
// Generic starter evaluator: the index lists every LIVE item (status not shipped/dropped) and links
// only existing item files. (The byte-exact render law is project-specific and lives in the content ring.)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
const argv = process.argv.slice(2);
const flag = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : dflt; };
const index = flag('--index', 'docs/BACKLOG.md');
const dir = flag('--backlog-dir', 'docs/backlog');
if (!existsSync(index)) { console.log(`index missing: ${index}`); process.exit(1); }
const text = readFileSync(index, 'utf8');
let bad = 0;
if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  let fm; try { fm = m ? yaml.parse(m[1]) : {}; } catch { continue; }
  if (fm?.status && !['shipped', 'dropped'].includes(fm.status) && !text.includes(f)) {
    console.log(`live item not in index: ${f} (status: ${fm.status})`); bad++;
  }
}
for (const link of text.matchAll(/\((?:\.\/)?backlog\/([^)#\s]+\.md)\)/g)) {
  if (!existsSync(join(dir, link[1]))) { console.log(`index links a missing item: ${link[1]}`); bad++; }
}
process.exit(bad ? 1 : 0);
