#!/usr/bin/env node
// Generic starter evaluator (§13 self-containment law): unsafe-cast scan, zero project dependencies.
// RUNTIME_STAGED_PATHS presence contract (== tools/lib/text-scan.mjs): unset → walk roots; '' → nothing.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOTS = ['services', 'libs'];
const PATTERNS = [/\bas\s+any\b/, /\bas\s+unknown\s+as\b/, /eslint-disable/];
const isTest = (p) => /(^|\/)tests?\//.test(p) || /\.(test|spec)\./.test(p);
function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') yield* walk(p); }
    else yield p;
  }
}
function targets() {
  if ('RUNTIME_STAGED_PATHS' in process.env) {
    return process.env.RUNTIME_STAGED_PATHS.split('\n').map((s) => s.trim()).filter(Boolean)
      .filter((p) => extname(p) === '.ts' && !isTest(p) && existsSync(p));
  }
  const out = [];
  for (const r of ROOTS) if (existsSync(r)) for (const p of walk(r)) if (extname(p) === '.ts' && !isTest(p)) out.push(p);
  return out;
}
let bad = 0;
for (const f of targets()) {
  const text = readFileSync(f, 'utf8');
  const hit = PATTERNS.find((rx) => rx.test(text));
  if (hit) { console.log(`${f}: matches ${hit}`); bad++; }
}
process.exit(bad ? 1 : 0);
