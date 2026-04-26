#!/usr/bin/env node
// cf-smoke.mjs — CloudFront route smoke probe.
// Asserts the deployed shell renders all 5 MFE routes (or their /login
// redirects) without console errors or failed charter-path requests.
//
// Usage:
//   pnpm cf-smoke --prefix=dev
//   node tools/probes/cf-smoke.mjs --prefix=dev [--region=us-east-1] [--routes=/foo,/bar]
//
// Reads CF URL from SSM /nestfolio/<prefix>-investor/web/distributionUrl.
// Requires AWS credentials (Leapp).

import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const DEFAULT_ROUTES = ['/investor', '/advisory', '/ledger', '/dashboard', '/onboarding'];
const CHARTER_PATH_RE = /\/(graphql|mfe|realtime)\//;

function parseArgs(argv) {
  const out = { prefix: null, region: null, routes: DEFAULT_ROUTES };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--prefix=')) out.prefix = a.slice('--prefix='.length);
    else if (a === '--prefix') out.prefix = argv[++i];
    else if (a.startsWith('--region=')) out.region = a.slice('--region='.length);
    else if (a === '--region') out.region = argv[++i];
    else if (a.startsWith('--routes=')) out.routes = a.slice('--routes='.length).split(',').map(s => s.trim()).filter(Boolean);
  }
  if (!out.prefix) {
    console.error('cf-smoke: --prefix is required (e.g. --prefix=dev)');
    process.exit(2);
  }
  return out;
}

function ssmGet(name, region) {
  const args = ['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value', '--output', 'text'];
  if (region) args.unshift(`--region=${region}`);
  const r = spawnSync('aws', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`cf-smoke: SSM read failed for ${name}.`);
    console.error(`Run \`bash infrastructure/scripts/deploy.sh sandbox --prefix=<prefix> --services=investor-web\` first, then retry.`);
    console.error(`(aws stderr: ${r.stderr.trim()})`);
    process.exit(1);
  }
  return r.stdout.trim();
}

function normalizeBaseUrl(s) {
  let u = s.trim();
  if (!/^https?:\/\//.test(u)) u = `https://${u}`;
  return u.replace(/\/+$/, '');
}

async function checkRoute(browser, baseUrl, route) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const consoleErrors = [];
  const requestFailures = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('requestfailed', req => {
    const url = req.url();
    if (CHARTER_PATH_RE.test(url)) {
      requestFailures.push({ url, failure: req.failure()?.errorText || 'unknown' });
    }
  });

  let response;
  let renderOk = false;
  let error = null;
  const url = baseUrl + route;
  try {
    response = await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Allow up to 10s for Angular to bootstrap and populate <app-root>.
    await page.waitForFunction(() => {
      const root = document.querySelector('app-root');
      return !!root && root.children.length > 0;
    }, { timeout: 10000 });
    renderOk = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  await ctx.close();

  const status = response ? response.status() : null;
  const ok = renderOk && (status === 200 || status === 304) && consoleErrors.length === 0 && requestFailures.length === 0;
  return { route, url, status, renderOk, consoleErrors, requestFailures, error, ok };
}

async function main() {
  const args = parseArgs(process.argv);
  const ssmPath = `/nestfolio/${args.prefix}-investor/web/distributionUrl`;
  const cfUrl = normalizeBaseUrl(ssmGet(ssmPath, args.region));
  console.log(`cf-smoke: prefix=${args.prefix} cfUrl=${cfUrl}`);
  console.log(`cf-smoke: routes=${args.routes.join(',')}`);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const r of args.routes) {
      results.push(await checkRoute(browser, cfUrl, r));
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  console.log('Per-route results:');
  for (const r of results) {
    const tag = r.ok ? 'PASS' : 'FAIL';
    console.log(`  [${tag}] ${r.route}  status=${r.status ?? 'n/a'}  rendered=${r.renderOk}  consoleErrors=${r.consoleErrors.length}  requestFailures=${r.requestFailures.length}`);
    if (!r.ok) {
      if (r.error) console.log(`    error: ${r.error}`);
      for (const e of r.consoleErrors) console.log(`    console.error: ${e}`);
      for (const f of r.requestFailures) console.log(`    requestfailed: ${f.url} (${f.failure})`);
    }
  }
  console.log('');

  if (failed.length > 0) {
    console.error(`cf-smoke: FAIL (${failed.length}/${results.length} routes)`);
    process.exit(1);
  }
  console.log(`cf-smoke: PASS (${results.length}/${results.length} routes)`);
}

main().catch(err => {
  console.error(`cf-smoke: unhandled error: ${err?.stack ?? err}`);
  process.exit(1);
});
