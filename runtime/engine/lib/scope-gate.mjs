// runtime/engine/lib/scope-gate.mjs — the scope-gate check (§9.2). "diff ⊆ the active item's scope"
// is a check that BITES: an escape files an inconsistency Finding and blocks the gate. Closes failure
// mode 3 structurally (with single-active). Pure cores + a self-resolving CLI (two modes: scope-gate +
// --single-active). No fix — an escape is a floor decision (widen scope, split the item, or revert).
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { globsOverlap } from './glob-overlap.mjs';

const isoNow = () => new Date().toISOString();
const toGlobs = (scope) => (scope ?? '').split(/[\s,]+/).filter(Boolean);

export function scopeGate({ activeItem, diffPaths }) {
  const globs = toGlobs(activeItem?.scope);
  const escapes = diffPaths.filter((p) => !globs.some((g) => globsOverlap(p, g)));
  const withinScope = escapes.length === 0;
  const findings = withinScope ? [] : [{
    id: 'active-item-scope-gate#0', check: 'active-item-scope-gate', kind: 'inconsistency',
    scope: escapes, detail: `diff escapes the declared scope of "${activeItem?.id}" (${activeItem?.scope}): ${escapes.join(', ')}`,
    raised_at: isoNow(),
  }];
  return { withinScope, escapes, findings };
}

export function singleActive(items) { return items.filter((i) => i.status === 'active'); }

/** Minimal frontmatter reader — ring-1 MUST NOT import .claude/skills (seam #1). Returns [{id, ...fm}]. */
export function readItems(backlogDir) {
  if (!existsSync(backlogDir)) return [];
  return readdirSync(backlogDir).filter((f) => f.endsWith('.md')).map((f) => {
    const m = readFileSync(join(backlogDir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const fm = m ? yaml.parse(m[1]) : {};
    return { id: fm?.id ?? f.replace(/\.md$/, ''), ...fm };
  });
}

function main() {
  // Both starter evaluators invoke this with NO --item-scope, so the CLI SELF-RESOLVES the active item
  // from --backlog-dir (default docs/backlog). --item-scope is an explicit override (tests). The item
  // store dir is injected, not hard-coded, so ring-1 stays project-agnostic (the pure cores never read fs).
  const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const backlogDir = args['backlog-dir'] ?? 'docs/backlog';

  if ('single-active' in args) {                                        // the `single-active` starter check
    const actives = singleActive(readItems(backlogDir));
    if (actives.length !== 1) console.log(`single-active broken: ${actives.length} active items (${actives.map((i) => i.id).join(', ')})`);
    process.exit(actives.length === 1 ? 0 : 1);
  }

  let activeItem;                                                       // the `active-item-scope-gate` check
  if (args['item-scope']) activeItem = { id: args['item-id'], scope: args['item-scope'] };
  else {
    const actives = singleActive(readItems(backlogDir));
    if (actives.length !== 1) { console.log(`scope-gate: expected exactly one active item, found ${actives.length}`); process.exit(actives.length === 0 ? 0 : 1); }
    activeItem = actives[0];
  }
  const diffPaths = execSync('git diff --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const r = scopeGate({ activeItem, diffPaths });
  for (const f of r.findings) console.log(f.detail);
  process.exit(r.withinScope ? 0 : 1);
}
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) main();
