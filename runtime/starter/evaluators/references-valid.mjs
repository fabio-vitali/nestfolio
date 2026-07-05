#!/usr/bin/env node
// Generic starter evaluator: every design/spec item's `references:` entry (a `path#anchor` string)
// resolves — path exists (repo-root or item-dir relative) and, when a #anchor is given, a matching
// heading exists outside code fences. Items of other types carry free-form references and are not
// enforced (the honest weaker form of the reference law — empirical: enforcing all types false-flags).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
const argv = process.argv.slice(2);
const flag = (f, dflt) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : dflt; };
const dir = flag('--backlog-dir', 'docs/backlog');
const slug = (h) => h.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
const headings = (text) => text.replace(/```[\s\S]*?```/g, '')
  .split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => slug(l.replace(/^#{1,6}\s+/, '')));
let bad = 0;
if (existsSync(dir)) for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
  const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
  let fm; try { fm = m ? yaml.parse(m[1]) : {}; } catch { continue; }   // malformed frontmatter is another check's job
  if (!['design', 'spec'].includes(fm?.type)) continue;                 // reference-bearing types only
  for (const ref of fm?.references ?? []) {
    const [path, anchor] = String(ref).split('#');
    const resolved = existsSync(path) ? path : (existsSync(join(dir, path)) ? join(dir, path) : null);
    if (!resolved) { console.log(`${f}: dangling reference path: ${ref}`); bad++; continue; }
    if (anchor && !headings(readFileSync(resolved, 'utf8')).includes(anchor.toLowerCase())) {
      console.log(`${f}: anchor not found: ${ref}`); bad++;
    }
  }
}
process.exit(bad ? 1 : 0);
