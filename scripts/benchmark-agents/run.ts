#!/usr/bin/env tsx
/* run.ts — sweep one task across its bench config's models[], write
 * benchmarks/tasks/<task>/<ISO>/raw-results.json. Sequential calls only
 * (Bedrock opus throttles on parallel sustained QPS).
 *
 * Comma-list parsing across multiple tasks lives at the SKILL.md layer (§8 of
 * the spec) — this script handles exactly one --task at a time.
 */

import { execSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { looksDegraded } from '@nestfolio/agent-orchestrator';
import { invokeStructured } from './lib/invoke-model';
import { asRate, median } from './lib/timings';
import { computeCostUSD, loadPricingCache } from './pricing-loader';
import type {
  FixtureFile,
  IterationResult,
  ModelSweep,
  ModelSweepAggregates,
  ModelsCache,
  RawResults,
  TaskBenchConfig,
  Tier,
} from './lib/types';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const RESULTS_ROOT = path.resolve('benchmarks/tasks');
const PRICING_PATH = path.resolve('benchmarks/cache/pricing.json');
const MODELS_CACHE_PATH = path.resolve('benchmarks/cache/models.json');

function loadModelsCache(): ModelsCache {
  if (!fsSync.existsSync(MODELS_CACHE_PATH)) {
    throw new Error(
      `models cache missing at ${MODELS_CACHE_PATH} — run scripts/benchmark-agents/refresh-models.ts`,
    );
  }
  return JSON.parse(fsSync.readFileSync(MODELS_CACHE_PATH, 'utf8')) as ModelsCache;
}

function resolveSweepSet(
  bench: { tier: Tier; productionConfig: { modelId: string } },
  cache: ModelsCache,
): readonly string[] {
  const candidates = cache.tiers[bench.tier];
  if (!candidates) {
    throw new Error(`tier ${bench.tier} not found in models.json. Re-run refresh-models.ts.`);
  }
  const top5 = candidates.slice(0, 5);
  const productionModelId = bench.productionConfig.modelId;
  const sweep = new Set<string>(top5);
  if (cache.excluded[productionModelId]) {
    console.warn(
      `[run] WARNING: production modelId ${productionModelId} is excluded ` +
        `(${cache.excluded[productionModelId]}). Sweep continues without anchor.`,
    );
  } else {
    sweep.add(productionModelId);
  }
  return [...sweep];
}

interface Args {
  readonly task: string;
  readonly iterations: number;
  readonly refreshPricing: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let task = '';
  let iterations = 3;
  let refreshPricing = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--task') task = argv[++i];
    else if (argv[i] === '--iterations') iterations = Number(argv[++i]);
    else if (argv[i] === '--refresh-pricing') refreshPricing = true;
  }
  if (!task) {
    console.error('usage: run.ts --task <name> [--iterations N] [--refresh-pricing]');
    process.exit(2);
  }
  if (!Number.isFinite(iterations) || iterations < 1) {
    console.error('--iterations must be a positive integer');
    process.exit(2);
  }
  return { task, iterations, refreshPricing };
}

function aggregate(
  iterations: readonly IterationResult[],
  hasRule: boolean,
): ModelSweepAggregates {
  const passes = iterations.filter((i) => i.schemaPass);
  const notDegraded = passes.filter((i) => i.notDegraded === true);
  const validationPass = passes.filter((i) => i.validationPass === true);
  const latencies = passes.map((i) => i.latencyMs);
  const costs = passes.map((i) => i.costUSD);
  return {
    schemaPassRate: asRate(passes.length, iterations.length),
    notDegradedRate: asRate(notDegraded.length, Math.max(passes.length, 1)),
    validationPassRate: hasRule
      ? asRate(validationPass.length, Math.max(passes.length, 1))
      : null,
    medianLatencyMs: latencies.length ? Math.round(median(latencies)) : 0,
    minLatencyMs: latencies.length ? Math.min(...latencies) : 0,
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    medianCostUSD: costs.length ? Number(median(costs).toFixed(6)) : 0,
    totalCostUSD: Number(costs.reduce((a, b) => a + b, 0).toFixed(6)),
    totalInputTokens: passes.reduce((a, b) => a + b.inputTokens, 0),
    totalOutputTokens: passes.reduce((a, b) => a + b.outputTokens, 0),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Pricing — refresh if missing, > 7 days old, or forced.
  const pricingStatMs = await fs
    .stat(PRICING_PATH)
    .then((s) => s.mtimeMs)
    .catch(() => 0);
  const needsRefresh =
    args.refreshPricing ||
    pricingStatMs === 0 ||
    Date.now() - pricingStatMs > 7 * 24 * 3600 * 1000;
  if (needsRefresh) {
    console.log('[run] refreshing pricing cache');
    execSync(
      'node -r ./tools/register-paths.js --import tsx scripts/benchmark-agents/refresh-pricing.ts',
      { stdio: 'inherit' },
    );
  }
  const pricing = loadPricingCache();

  // Bench config + fixture.
  const benchPath = path.join(TASKS_DIR, `${args.task}.bench.ts`);
  const mod = (await import(benchPath)) as { benchConfig: TaskBenchConfig };
  const bench = mod.benchConfig;
  const fixtureRaw = await fs.readFile(path.resolve(bench.fixturePath), 'utf8');
  const fixture = JSON.parse(fixtureRaw) as FixtureFile;
  const modelsCache = loadModelsCache();
  const modelsToSweep = resolveSweepSet(bench, modelsCache);
  console.log(
    `[run] task=${bench.taskName} models=${modelsToSweep.length} iterations=${args.iterations}`,
  );
  console.log(`[run] modelsToSweep (${modelsToSweep.length}): ${modelsToSweep.join(', ')}`);

  const startedAt = new Date().toISOString();
  const sweeps: ModelSweep[] = [];

  for (const modelId of modelsToSweep) {
    console.log(`[run] sweeping ${modelId}`);
    const iters: IterationResult[] = [];
    for (let ix = 0; ix < args.iterations; ix++) {
      const r = await invokeStructured({
        modelId,
        maxTokens: bench.productionConfig.maxTokens,
        temperature: bench.productionConfig.temperature,
        schema: bench.productionConfig.schema,
        prompt: fixture.prompt,
      });
      const cost = r.schemaPass
        ? computeCostUSD(pricing, modelId, r.inputTokens, r.outputTokens)
        : 0;
      let notDegraded: boolean | null = null;
      let validationPass: boolean | null = null;
      if (r.schemaPass && r.parsed !== null) {
        notDegraded = !looksDegraded(r.parsed, bench.productionConfig.schema);
        if (bench.validationRule) {
          const v = bench.validationRule.validate(r.parsed as never, {
            state: {},
            attempt: 0,
          });
          validationPass = v.valid;
        }
      }
      iters.push({
        ix,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUSD: Number(cost.toFixed(6)),
        schemaPass: r.schemaPass,
        notDegraded,
        validationPass,
        output: r.parsed,
        error: r.error,
      });
      console.log(
        `  ix=${ix} schemaPass=${r.schemaPass} lat=${r.latencyMs}ms tok=${r.inputTokens}/${r.outputTokens} cost=$${cost.toFixed(4)}`,
      );
    }
    sweeps.push({
      modelId,
      iterations: iters,
      aggregates: aggregate(iters, bench.validationRule !== null),
    });
  }

  const finishedAt = new Date().toISOString();
  const out: RawResults = {
    taskName: bench.taskName,
    service: bench.service,
    configFilePath: bench.configFilePath,
    fixturePath: bench.fixturePath,
    iterationsPerCombo: args.iterations,
    startedAt,
    finishedAt,
    pricingFetchedAt: pricing.fetchedAt,
    models: sweeps,
  };

  const outDir = path.join(RESULTS_ROOT, bench.taskName, startedAt.replace(/[:.]/g, '-'));
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'raw-results.json');
  await fs.writeFile(outPath, JSON.stringify(out, null, 2));
  console.log(`[run] raw-results=${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
