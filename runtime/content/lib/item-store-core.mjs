// runtime/content/lib/item-store-core.mjs — zero-arg core (runtime `module:` convention): validate every
// item in the store against the ring-1 ItemSchema (identity binding, re-freeze 2026-07-05). Repo-integrity
// check (whole store, not diff-scoped): a corrupt item is corrupt regardless of what's staged. Covers the
// class backlog-lint is blind to — element-shape corruption (an unquoted scalar with an embedded colon
// parses as a one-key mapping) — and unlike readItems() (fail-closed throw) it reports per-file findings.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'yaml';
import { validateItem } from '../../engine/schema/item.schema.ts';

export function itemStoreViolations(dir = 'docs/backlog') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.md'))) {
    let detail;
    try {
      const m = readFileSync(join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
      const fm = m ? yaml.parse(m[1]) : {};
      const r = validateItem({ id: fm?.id ?? f.replace(/\.md$/, ''), ...fm });
      if (!r.ok) detail = r.error;
    } catch (e) { detail = String(e?.message ?? e); }
    if (detail) out.push({ detail: `${f}: ${detail}`, scope: ['docs/backlog/*.md'], evidence: join(dir, f) });
  }
  return out;
}
