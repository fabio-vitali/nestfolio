#!/usr/bin/env tsx
/* refresh-pricing.ts — copies the checked-in pricing manifest to
 * benchmarks/cache/pricing.json with the current timestamp. The AWS Pricing
 * API is NOT used (investigation during Task 5 showed display-name filter +
 * no Claude 4.x coverage). The manifest at scripts/benchmark-agents/pricing.manifest.json
 * is the source of truth; update it manually when AWS revises Bedrock public
 * pricing.
 *
 * Verifies every sweep modelId (across the 6 bench configs) resolves either
 * literally or via baseModelIdFor() — that's the structural gate keeping the
 * manifest aligned with whatever the bench configs currently sweep.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { baseModelIdFor } from './pricing-loader';
import type { PricingCache } from './lib/types';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const MANIFEST_PATH = path.resolve('scripts/benchmark-agents/pricing.manifest.json');
const OUT_PATH = path.resolve('benchmarks/cache/pricing.json');

interface ManifestFile {
  readonly lastUpdated: string;
  readonly source: string;
  readonly notes?: string;
  readonly models: Record<
    string,
    { readonly inputUSDPerMTok: number; readonly outputUSDPerMTok: number }
  >;
}

async function collectModelIds(): Promise<string[]> {
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith('.bench.ts'));
  const set = new Set<string>();
  for (const f of files) {
    const mod = (await import(path.join(TASKS_DIR, f))) as {
      benchConfig: { models: readonly string[] };
    };
    for (const m of mod.benchConfig.models) set.add(m);
  }
  return [...set];
}

async function main(): Promise<void> {
  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as ManifestFile;
  const sweepIds = await collectModelIds();
  console.log(`[refresh-pricing] manifest lastUpdated=${manifest.lastUpdated}`);
  console.log(`[refresh-pricing] verifying ${sweepIds.length} sweep modelIds against manifest`);

  const out: PricingCache = { fetchedAt: new Date().toISOString(), models: {} };
  const misses: string[] = [];
  for (const id of sweepIds) {
    const literal = manifest.models[id];
    const base = manifest.models[baseModelIdFor(id)];
    const entry = literal ?? base;
    if (!entry) {
      misses.push(`${id} (also missed base ${baseModelIdFor(id)})`);
      continue;
    }
    out.models[literal ? id : baseModelIdFor(id)] = entry;
  }
  if (misses.length > 0) {
    console.error('[refresh-pricing] manifest missing entries for:');
    for (const m of misses) console.error(`  - ${m}`);
    console.error(`  Edit ${MANIFEST_PATH} and rerun.`);
    process.exit(1);
  }
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-pricing] wrote ${OUT_PATH} (${Object.keys(out.models).length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
