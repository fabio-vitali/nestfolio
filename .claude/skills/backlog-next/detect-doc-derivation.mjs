#!/usr/bin/env node
/**
 * Detect which derived docs need regenerating based on the current branch's diff.
 *
 * Usage:
 *   node detect-doc-derivation.mjs [--base=<ref>] [--json]
 *
 * Default base: origin/main.
 *
 * Exit codes:
 *   0  — derivation needed (see "Actions" output)
 *   10 — no derivation needed
 *   1  — error
 *
 * The mapping is documented in doc-derivation-paths.md.
 *
 * Honest limit: this script identifies WHICH derivation skills should run.
 * It does NOT execute them — derivation skills can surface inconsistencies
 * that need human / agent decisions.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
  }),
);

const base = args.base || 'origin/main';
const asJson = args.json === true;
const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

function shSafe(cmd) {
  try {
    return {
      ok: true,
      out: execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT, stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
    };
  } catch (err) { return { ok: false }; }
}

let changedFiles;
try {
  changedFiles = sh(`git diff --name-only ${base}...HEAD`)
    .split('\n')
    .filter(Boolean);
} catch (err) {
  console.error(`[detect-doc-derivation] git diff failed against base '${base}': ${err.message}`);
  process.exit(1);
}

const actions = new Map(); // key: action description → set of triggering files
const affectedServices = new Set();
const newServices = new Set();
const svcDirs = new Map(); // svc name → "services/<domain>/<service>" (for accurate display)
const flowSpecsToValidate = new Set();
const flowSpecsTouched = new Set();
const adapterChanges = new Set();

function addAction(key, file) {
  if (!actions.has(key)) actions.set(key, new Set());
  actions.get(key).add(file);
}

for (const file of changedFiles) {
  // Services are two-level: services/<domain>/<service>/<rest>.
  const svcMatch = file.match(/^services\/([^/]+)\/([^/]+)\/(.+)$/);
  if (svcMatch) {
    const [, domain, service, rest] = svcMatch;
    const svc = service;                 // service name (unique; consumed by audit-service)
    const svcDir = `services/${domain}/${service}`;
    svcDirs.set(svc, svcDir);

    // Tests / project config don't need derivation
    if (rest.startsWith('test/')) continue;
    if (rest === 'project.json' || rest === 'package.json' || rest.startsWith('tsconfig')) continue;

    // New service detection: does the service folder exist on the base ref?
    const baseExists = shSafe(`git cat-file -e ${base}:${svcDir}/project.json`).ok;
    if (!baseExists) {
      newServices.add(svc);
      continue;
    }

    affectedServices.add(svc);

    // CDK stack changes → C4 + service card
    if (rest.startsWith('infrastructure/')) {
      addAction('generate-c4-diagrams (full pipeline)', file);
      addAction(`audit-service ${svc}`, file);
    }
    // Domain events / contracts → flow spec regen
    else if (rest.startsWith('domain/events.ts') || rest === 'domain/events.ts') {
      addAction(`audit-service ${svc}`, file);
      addAction(`identify-and-regen affected flow specs (grep flows/*.flow.yaml for '${svc}')`, file);
    }
    // Subscription config (event-listener.ts) → flow spec regen
    else if (rest.startsWith('src/event-listener') || rest === 'src/event-listener.ts') {
      addAction(`audit-service ${svc}`, file);
      addAction(`identify-and-regen affected flow specs (grep flows/*.flow.yaml for '${svc}')`, file);
    }
    // Any other source change → service card audit
    else if (rest.startsWith('src/') || rest.startsWith('domain/')) {
      addAction(`audit-service ${svc}`, file);
    }

    // Cross-domain adapter rules
    if (svc.endsWith('-adpt')) {
      adapterChanges.add(svc);
    }
  }
  else if (file.startsWith('flows/') && file.endsWith('.flow.yaml')) {
    flowSpecsTouched.add(file);
    addAction(`validate-flow ${file}`, file);
  }
  else if (file.match(/^apps\/investor-web\/[^/]+\//)) {
    // Substantive MFE change — skip lockfile-only or style-only
    if (!file.endsWith('package.json') && !file.endsWith('.css') && !file.endsWith('.scss')) {
      const mfeMatch = file.match(/^apps\/investor-web\/([^/]+)\//);
      if (mfeMatch) {
        addAction(`MFE service card regen for apps/investor-web/${mfeMatch[1]} (if present)`, file);
      }
    }
  }
}

// New service implies a more thorough sweep
for (const svc of newServices) {
  const dir = `${svcDirs.get(svc) ?? `services/${svc}`}/`;
  addAction('generate-c4-diagrams (full pipeline)', dir);
  addAction(`audit-service ${svc}`, dir);
  addAction(`flow spec coverage for new service ${svc}`, dir);
  addAction('audit-system (cross-domain consistency check for new service)', dir);
}

// Adapter changes touch both ends of a flow
for (const adpt of adapterChanges) {
  addAction(`audit-domain for both domains touched by ${adpt}`, `${svcDirs.get(adpt) ?? `services/${adpt}`}/`);
}

const hasDerivation = actions.size > 0;

if (asJson) {
  console.log(JSON.stringify({
    derivation: hasDerivation,
    actions: [...actions.entries()].map(([action, files]) => ({ action, files: [...files] })),
    affectedServices: [...affectedServices],
    newServices: [...newServices],
    flowSpecsTouched: [...flowSpecsTouched],
    adapterChanges: [...adapterChanges],
    base,
    changedCount: changedFiles.length,
  }, null, 2));
} else {
  console.log(`derivation=${hasDerivation}`);
  console.log(`affectedServices=${[...affectedServices].sort().join(',')}`);
  if (newServices.size > 0) console.log(`newServices=${[...newServices].sort().join(',')}`);
  if (adapterChanges.size > 0) console.log(`adapterChanges=${[...adapterChanges].sort().join(',')}`);

  if (hasDerivation) {
    console.log(`\nActions (${actions.size}):`);
    let i = 1;
    for (const [action, files] of actions) {
      console.log(`  ${i}. ${action}`);
      for (const f of files) console.log(`       ← ${f}`);
      i++;
    }
    console.log('\nRun these via the matching skills, resolve any inconsistencies they surface, then commit the regen IN the same workstream.');
  } else {
    console.log('reason=no source changes require derived-doc regen');
  }
}

process.exit(hasDerivation ? 0 : 10);
