// runtime/content/lib/plan-views-core.mjs — zero-arg core (runtime `module:` convention): the read-time
// planner views (planNext, computeImpact, renderIndex) are TOTAL over the real item store — they run
// without throwing on every item docs/backlog actually carries. Guards the class item-store-valid cannot
// see: view code assuming one arm of a schema union (references "path#anchor" string vs {path, anchor})
// while the store legally carries the other. Repo-integrity check (whole store, not diff-scoped), ~ms.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { planNext, computeImpact, renderIndex } from '../../engine/lib/plan-next.mjs';

export function planViewsViolations(dir = 'docs/backlog') {
  if (!existsSync(dir)) return [];
  const backlog = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    try {
      const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
      const fm = m ? yaml.parse(m[1]) : null;
      if (fm && typeof fm === 'object' && fm.id) backlog.push({ ...fm, __file: f });
    } catch { /* unparseable frontmatter is item-store-valid's finding, not a view crash */ }
  }
  const out = [];
  const seen = new Set();
  const attempt = (view, fn, evidence) => {
    try { fn(); } catch (e) {
      const detail = `${view} threw over the store: ${String(e?.message ?? e)}`;
      if (seen.has(detail)) return;                                // one poison ref crashes every item — report once
      seen.add(detail);
      out.push({ detail, scope: ['docs/backlog/*.md', 'runtime/engine/lib/plan-next.mjs'], evidence });
    }
  };
  attempt('planNext', () => planNext({ backlog, registry: {}, env: {} }), dir);
  attempt('renderIndex', () => renderIndex({ backlog }), dir);
  for (const item of backlog) attempt('computeImpact', () => computeImpact({ item, backlog, blastOf: null }), join(dir, item.__file));
  return out;
}
