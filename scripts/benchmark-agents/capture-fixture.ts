#!/usr/bin/env tsx
/* capture-fixture.ts — pulls the most recent successful Bedrock invocation
 * matching a task's prompt prefix from CloudWatch Logs Insights, captures the
 * verbatim post-substitution prompt, writes benchmarks/fixtures/<task>.input.json.
 *
 * Prereq: Task 0 (Bedrock model invocation logging enabled on dev).
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CloudWatchLogsClient,
  GetQueryResultsCommand,
  StartQueryCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import type { FixtureFile, TaskBenchConfig } from './lib/types';

// Override via env if Task 0 step 2 pinned a different log group name.
const LOG_GROUP =
  process.env.BEDROCK_INVOCATION_LOG_GROUP ?? '/aws/bedrock/dev-invocations';

const TASKS_DIR = path.resolve('scripts/benchmark-agents/tasks');
const FIXTURES_DIR = path.resolve('benchmarks/fixtures');

function derivePromptPrefix(template: string): string {
  const ix = template.indexOf('{input}');
  const prefix = ix >= 0 ? template.slice(0, ix) : template;
  return prefix.replace(/\s+$/, '').slice(0, 256);
}

function sha256(s: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
}

async function runInsightsQuery(
  client: CloudWatchLogsClient,
  logGroupName: string,
  queryString: string,
): Promise<Array<Array<{ field?: string; value?: string }>>> {
  const start = await client.send(
    new StartQueryCommand({
      logGroupName,
      startTime: Math.floor(Date.now() / 1000) - 24 * 3600,
      endTime: Math.floor(Date.now() / 1000),
      queryString,
      limit: 5,
    }),
  );
  const queryId = start.queryId;
  if (!queryId) throw new Error('StartQuery returned no queryId');
  for (let i = 0; i < 30; i++) {
    const r = await client.send(new GetQueryResultsCommand({ queryId }));
    if (r.status === 'Complete') {
      return (r.results ?? []) as Array<Array<{ field?: string; value?: string }>>;
    }
    if (r.status === 'Failed' || r.status === 'Cancelled') {
      throw new Error(`Insights query ${r.status}: ${queryString}`);
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`Insights query timed out after 30s: ${queryString}`);
}

function extractPromptText(parsed: unknown): string {
  const p = parsed as {
    input?: {
      inputBodyJson?: { messages?: Array<{ content?: unknown }> };
      messages?: Array<{ content?: unknown }>;
    };
  };
  const messages = p?.input?.inputBodyJson?.messages ?? p?.input?.messages ?? [];
  const content = messages?.[0]?.content ?? [];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c as { text?: string }).text ?? '').join('');
  }
  return '';
}

async function captureForTask(taskArg: string): Promise<void> {
  const benchPath = path.join(TASKS_DIR, `${taskArg}.bench.ts`);
  const mod = (await import(benchPath)) as { benchConfig: TaskBenchConfig };
  const { taskName, productionConfig } = mod.benchConfig;
  if (taskName !== taskArg) {
    throw new Error(`bench file ${benchPath} has taskName=${taskName}, expected ${taskArg}`);
  }

  const prefix = derivePromptPrefix(productionConfig.promptTemplate);
  const prefixHash = sha256(prefix);
  console.log(`[capture-fixture] task=${taskName} modelId=${productionConfig.modelId}`);
  console.log(`[capture-fixture] prefix(${prefix.length}c)=${prefix.slice(0, 80)}...`);

  // Insights filter: modelId match + first 40 chars of the prompt prefix appear
  // in @message. The 40-char window is chosen so the substring is short enough
  // to be unique to this task (each task's system instruction is distinct by
  // construction) yet long enough to avoid false positives across tasks.
  const subPrefix = prefix.slice(0, 40);
  const query = `
    fields @timestamp, @logStream, @message
    | filter modelId = "${productionConfig.modelId}"
    | filter @message like ${JSON.stringify(subPrefix)}
    | sort @timestamp desc
    | limit 5
  `;

  const client = new CloudWatchLogsClient({ region: 'us-east-1' });
  const rows = await runInsightsQuery(client, LOG_GROUP, query);

  if (rows.length === 0) {
    console.error(`[capture-fixture] no successful match for ${taskName} in last 24h.`);
    console.error(`  Tried prefix: ${prefix.slice(0, 120)}...`);
    console.error(`  modelId: ${productionConfig.modelId}`);
    console.error(`  Hint: (1) trigger a fresh dev decision cycle,`);
    console.error(`        (2) verify Bedrock invocation logging is enabled (Task 0),`);
    console.error(`        (3) check whether the task's prompt template has changed`);
    console.error(`            (the prefix you'd find in logs would differ).`);
    process.exit(1);
  }

  const msgField = rows[0].find((f) => f.field === '@message')?.value ?? '';
  const streamField = rows[0].find((f) => f.field === '@logStream')?.value ?? '';
  const parsed = JSON.parse(msgField);
  const text = extractPromptText(parsed);

  if (!text || !text.includes(subPrefix)) {
    throw new Error(
      `Insights returned a row but the extracted prompt does not contain the derived prefix. ` +
        `Likely a JSON path mismatch in extractPromptText() — verify against Task 0 step 2 pinning. ` +
        `Extracted (first 200): ${text.slice(0, 200)}`,
    );
  }

  const fixture: FixtureFile = {
    capturedAt: new Date().toISOString(),
    modelId: productionConfig.modelId,
    logStreamName: streamField,
    promptPrefixHash: prefixHash,
    prompt: text,
  };

  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  const out = path.join(FIXTURES_DIR, `${taskName}.input.json`);
  await fs.writeFile(out, JSON.stringify(fixture, null, 2));
  console.log(`[capture-fixture] wrote ${out} (prompt ${text.length} chars)`);
}

async function main(): Promise<void> {
  const ix = process.argv.indexOf('--task');
  if (ix === -1 || !process.argv[ix + 1]) {
    console.error('usage: capture-fixture.ts --task <name>');
    process.exit(2);
  }
  await captureForTask(process.argv[ix + 1]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
