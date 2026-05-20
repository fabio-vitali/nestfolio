#!/usr/bin/env tsx
/* refresh-pricing.ts — query AWS Pricing API for on-demand token prices for
 * every modelId in models.json (across all tiers) + every production modelId
 * from the 6 task bench configs. Write benchmarks/cache/pricing.json.
 *
 * No fallback / overrides file: if the Pricing API has no record for a
 * modelId, this script exits 1 with an explicit list.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PricingClient, GetProductsCommand } from '@aws-sdk/client-pricing';
import { resolvePricingIdentity } from './lib/pricing-display-name';
import { pickOnDemandPrice, type PricingRecord } from './lib/usagetype-picker';
import type { ModelsCache, PricingCache, PricingEntry, TaskBenchConfig } from './lib/types';

const REGION = 'us-east-1';
// AWS publishes on-demand pricing for some models (notably some legacy Anthropic
// inference profiles like Opus 4.1) ONLY in us-west-2. Probed after us-east-1
// returns zero records so the primary region keeps its precedence in reports.
const FALLBACK_REGIONS: readonly string[] = ['us-west-2'];
const MODELS_CACHE_PATH = path.resolve('benchmarks/cache/models.json');
const PRICING_OUT_PATH = path.resolve('benchmarks/cache/pricing.json');
const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');

async function collectProductionModelIds(): Promise<readonly string[]> {
  const files = (await fs.readdir(TASKS_DIR)).filter((f) => f.endsWith('.bench.ts'));
  const set = new Set<string>();
  for (const f of files) {
    const mod = (await import(path.join(TASKS_DIR, f))) as { benchConfig: TaskBenchConfig };
    set.add(mod.benchConfig.productionConfig.modelId);
  }
  return [...set];
}

async function getProducts(
  client: PricingClient,
  serviceCode: string,
  identityField: string,
  identityValue: string,
  regionCode: string,
): Promise<PricingRecord[]> {
  const out = await client.send(
    new GetProductsCommand({
      ServiceCode: serviceCode,
      Filters: [
        { Type: 'TERM_MATCH', Field: identityField, Value: identityValue },
        { Type: 'TERM_MATCH', Field: 'regionCode', Value: regionCode },
      ],
    }),
  );
  const records: PricingRecord[] = [];
  for (const raw of out.PriceList ?? []) {
    // The SDK's __DocumentType wrapper is an object whose toString() yields the
    // JSON payload; typeof is 'object' but direct property access returns undefined.
    // Always String()-cast before JSON.parse so both string and wrapper variants parse.
    const item = JSON.parse(typeof raw === 'string' ? raw : String(raw));
    const usagetype = item.product?.attributes?.usagetype as string | undefined;
    const terms = (item.terms?.OnDemand ?? {}) as Record<
      string,
      { priceDimensions?: Record<string, { pricePerUnit?: { USD?: string } }> }
    >;
    for (const tval of Object.values(terms)) {
      for (const dim of Object.values(tval.priceDimensions ?? {})) {
        const usd = dim.pricePerUnit?.USD;
        if (usagetype && usd !== undefined) {
          records.push({ usagetype, pricePerUnit: Number(usd) });
        }
      }
    }
  }
  return records;
}

/** Probe regions in order until one returns records. Returns the records plus
 * the region they came from so callers can surface cross-region pricing. */
async function getProductsWithFallback(
  client: PricingClient,
  serviceCode: string,
  identityField: string,
  identityValue: string,
): Promise<{ records: PricingRecord[]; regionCode: string }> {
  const regions = [REGION, ...FALLBACK_REGIONS];
  for (const regionCode of regions) {
    const records = await getProducts(client, serviceCode, identityField, identityValue, regionCode);
    if (records.length > 0) return { records, regionCode };
  }
  return { records: [], regionCode: REGION };
}

async function main(): Promise<void> {
  // Universe = union of (tier candidates from models.json) + (production modelIds from bench.ts files)
  const modelsCache = JSON.parse(await fs.readFile(MODELS_CACHE_PATH, 'utf8')) as ModelsCache;
  const tierIds = Object.values(modelsCache.tiers).flat();
  const productionIds = await collectProductionModelIds();
  const universe = [...new Set<string>([...tierIds, ...productionIds])];
  console.log(`[refresh-pricing] resolving ${universe.length} modelIds via AWS Pricing API`);

  const client = new PricingClient({ region: REGION });
  const out: PricingCache = { fetchedAt: new Date().toISOString(), models: {} };
  const unresolved: string[] = [];

  for (const modelId of universe) {
    const id = resolvePricingIdentity(modelId);
    process.stdout.write(`  ${modelId}…`);
    const { records, regionCode } = await getProductsWithFallback(
      client,
      id.serviceCode,
      id.identityField,
      id.identityValue,
    );
    if (records.length === 0) {
      unresolved.push(modelId);
      process.stdout.write(' NO RECORDS\n');
      continue;
    }
    try {
      const prices = pickOnDemandPrice(records, modelId, id.serviceCode);
      const entry: PricingEntry = {
        inputUSDPerMTok: prices.inputUSDPerMTok,
        outputUSDPerMTok: prices.outputUSDPerMTok,
        source: 'aws-pricing-api',
        serviceCode: id.serviceCode,
        inputUsagetype: prices.inputUsagetype,
        outputUsagetype: prices.outputUsagetype,
        regionCode,
      };
      (out.models as Record<string, PricingEntry>)[modelId] = entry;
      const regionTag = regionCode === REGION ? '' : ` [${regionCode}]`;
      process.stdout.write(` $${prices.inputUSDPerMTok}/$${prices.outputUSDPerMTok}${regionTag}\n`);
    } catch (err) {
      unresolved.push(modelId);
      process.stdout.write(` PICKER ERROR: ${(err as Error).message}\n`);
    }
  }

  if (unresolved.length > 0) {
    console.error('[refresh-pricing] AWS Pricing API missing on-demand entries for:');
    for (const m of unresolved) console.error(`  - ${m}`);
    console.error('Either remove these models from tiers.json / production configs');
    console.error('or wait for AWS to publish them.');
    process.exit(1);
  }

  await fs.mkdir(path.dirname(PRICING_OUT_PATH), { recursive: true });
  await fs.writeFile(PRICING_OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`[refresh-pricing] wrote ${PRICING_OUT_PATH} (${Object.keys(out.models).length} entries)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
