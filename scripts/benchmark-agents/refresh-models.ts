#!/usr/bin/env tsx
/* refresh-models.ts — discover the Bedrock catalog, tier-filter, account-access
 * probe, and write benchmarks/cache/models.json.
 *
 * Cadence: 30-day TTL, or stale on tiers.json change. Trigger logic lives in
 * the SKILL preflight (§1) — this script always refreshes when invoked.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import { ChatBedrockConverse } from '@langchain/aws';
import { dedupeUsStarPreference, sizeClassFor } from './lib/catalog-loader';
import { filterCatalogByTier, type CatalogEntry } from './lib/tier-filter';
import type { ExcludedReason, ModelsCache, Tier } from './lib/types';
import tiersJson from './tiers.json';

const REGION = 'us-east-1';
const TIERS_PATH = path.resolve('scripts/benchmark-agents/tiers.json');
const OUT_PATH = path.resolve('benchmarks/cache/models.json');

async function listActiveTextModels(client: BedrockClient): Promise<readonly string[]> {
  const out = await client.send(
    new ListFoundationModelsCommand({ byOutputModality: 'TEXT', byInferenceType: 'ON_DEMAND' }),
  );
  const summaries = out.modelSummaries ?? [];
  return summaries
    .filter((s) => s.modelLifecycle?.status === 'ACTIVE')
    .map((s) => s.modelId ?? '')
    .filter((id) => id.length > 0);
}

async function listSystemInferenceProfileIds(client: BedrockClient): Promise<readonly string[]> {
  const out = await client.send(new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED' }));
  return (out.inferenceProfileSummaries ?? [])
    .map((p) => p.inferenceProfileId ?? '')
    .filter((id) => id.length > 0);
}

async function probeAccess(modelId: string): Promise<ExcludedReason | null> {
  const llm = new ChatBedrockConverse({ model: modelId, region: REGION, maxTokens: 1 });
  try {
    await llm.invoke('1');
    return null;
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AccessDeniedException') return 'no model access grant';
    if (e.name === 'ValidationException') return 'invalid modelId form (region/profile suffix shift)';
    if (e.name === 'ResourceNotFoundException') return 'not available in region';
    if (e.name === 'ThrottlingException') {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await llm.invoke('1');
        return null;
      } catch (err2) {
        const e2 = err2 as { name?: string };
        return `probe-failed: ${e2.name ?? 'throttling-retried'}` as ExcludedReason;
      }
    }
    return `probe-failed: ${e.name ?? 'unknown'}` as ExcludedReason;
  }
}

async function buildCatalog(modelIds: readonly string[]): Promise<{
  catalog: CatalogEntry[];
  excluded: Record<string, ExcludedReason>;
}> {
  const excluded: Record<string, ExcludedReason> = {};
  const catalog: CatalogEntry[] = [];
  for (const modelId of modelIds) {
    const sc = sizeClassFor(modelId);
    if (sc === 'unknown') {
      excluded[modelId] = 'sizeClass-unknown: no vendor classification';
      continue;
    }
    process.stdout.write(`  probe ${modelId}…`);
    const reason = await probeAccess(modelId);
    if (reason) {
      excluded[modelId] = reason;
      process.stdout.write(` excluded (${reason})\n`);
      continue;
    }
    process.stdout.write(` ok\n`);
    catalog.push({ modelId, sizeClass: sc, contextWindow: 200000 }); // ctx assumed 200k; refined below
  }
  return { catalog, excluded };
}

async function main(): Promise<void> {
  const client = new BedrockClient({ region: REGION });
  console.log('[refresh-models] listing foundation models…');
  const text = await listActiveTextModels(client);
  console.log('[refresh-models] listing system inference profiles…');
  const profiles = await listSystemInferenceProfileIds(client);

  console.log(`[refresh-models] catalog size: ${text.length} base + ${profiles.length} profiles`);

  const combined = dedupeUsStarPreference([...text, ...profiles]);
  console.log(`[refresh-models] after us.* dedup: ${combined.length}`);

  const { catalog, excluded } = await buildCatalog(combined);

  const tiers: Record<Tier, readonly string[]> = {} as Record<Tier, readonly string[]>;
  for (const tierName of Object.keys(tiersJson) as readonly Tier[]) {
    tiers[tierName] = filterCatalogByTier(catalog, tierName, tiersJson).map((e) => e.modelId);
  }

  const uncategorized = catalog
    .filter((e) => !Object.values(tiers).some((list) => list.includes(e.modelId)))
    .map((e) => e.modelId);

  const tiersHash = createHash('sha256').update(await fs.readFile(TIERS_PATH)).digest('hex');

  const out: ModelsCache = {
    fetchedAt: new Date().toISOString(),
    tiersHash,
    tiers,
    excluded,
    uncategorized,
  };

  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-models] wrote ${OUT_PATH}`);
  console.log('[refresh-models] tier sizes:');
  for (const [t, ids] of Object.entries(tiers)) console.log(`  ${t}: ${ids.length}`);
  if (uncategorized.length > 0) {
    console.log(`[refresh-models] INFO uncategorized (no tier matched): ${uncategorized.join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
