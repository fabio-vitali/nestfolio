#!/usr/bin/env node
/**
 * Detect whether the current branch's diff requires a dev-sandbox deploy.
 *
 * Usage:
 *   node detect-deploy-needed.mjs [--base=<ref>] [--json]
 *
 * Default base: origin/main.
 *
 * Exit codes:
 *   0  — deploy needed (Tier 1 paths matched, or unknown paths under conservative default)
 *   10 — no deploy needed (all changes Tier 0)
 *   1  — error (git failure, no diff available, etc.)
 *
 * Output (stdout):
 *   deploy=true|false
 *   services=svc1,svc2
 *   reason=<top reason summary>
 *   Then per-file detail under "Triggers:" / "Skipped (no-deploy):"
 *
 * The mapping is documented in deploy-paths.md.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { affectedProjects, loadGraph } from '../../../tools/affected-projects.mjs';

// Tier 1 — deploy required. Order matters: first match wins for service extraction.
// Service paths are `services/<domain>/<service>/...`; the capture group is the service name (m[1]).
export const TIER1 = [
  { re: /^services\/[^/]+\/([^/]+)\/src\//,            reason: 'Lambda code',         service: true  },
  { re: /^services\/[^/]+\/([^/]+)\/infrastructure\//, reason: 'CDK stack',           service: true  },
  { re: /^services\/[^/]+\/([^/]+)\/domain\//,         reason: 'event/intent schema', service: true  },
  { re: /^infrastructure\//,                    reason: 'shared CDK / scripts',service: false },
  { re: /^libs\/event-processor\//,             reason: 'deployed library',    service: false },
  { re: /^libs\/cdk-constructs\//,              reason: 'deployed library',    service: false },
  { re: /^libs\/agent-orchestrator\//,          reason: 'deployed library',    service: false },
  { re: /^libs\/event-types\//,                 reason: 'deployed library',    service: false },
  { re: /^libs\/test-support\//,                reason: 'integ-test harness',  service: false },
  { re: /^libs\/integration-testing\//,         reason: 'integ-test harness',  service: false },
  { re: /^apps\/investor-web\//,                reason: 'frontend',            service: false },
  { re: /^libs\/ui\//,                          reason: 'frontend lib',        service: false },
  { re: /^libs\/frontend-deps\//,               reason: 'frontend lib',        service: false },
  { re: /^libs\/shell\//,                       reason: 'frontend lib',        service: false },
];

// Tier 0 — never deploy.
export const TIER0 = [
  /^apps\/e2e-feature-tests\//,
  /^apps\/nestfolio-e2e\//,
  /^docs\//,
  /^flows\//,
  /^\.claude\//,
  /^tools\//,           // tools/*.mjs = repo tooling, never a deploy artifact

  /^MEMORY\.md$/,
  /^README(\.md)?$/,
  /^[^/]+\.md$/,        // any markdown at root
  /^\.gitignore$/,
  /^\.editorconfig$/,
  /^\.prettierrc/,
  /^\.eslintrc/,
];

// Files matching these are infrastructure-adjacent and trigger deploy
// regardless of where they sit.
export const ROOT_DEPLOY = [
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^tsconfig\.base\.json$/,
];

export function classifyChanges(changedFiles) {
  const triggers = [];
  const skipped = [];
  const unknownPaths = [];
  const servicesSet = new Set();

  for (const file of changedFiles) {
    let matched = false;
    for (const rule of TIER1) {
      const m = file.match(rule.re);
      if (m) {
        triggers.push({ file, reason: rule.reason });
        if (rule.service) servicesSet.add(m[1]);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (ROOT_DEPLOY.some((re) => re.test(file))) {
      triggers.push({ file, reason: 'workspace-wide config' });
      continue;
    }

    if (TIER0.some((re) => re.test(file))) {
      skipped.push({ file, reason: 'no-deploy path' });
      continue;
    }

    unknownPaths.push(file);
  }

  const deploy = triggers.length > 0 || unknownPaths.length > 0;
  return {
    deploy,
    services: [...servicesSet].sort(),
    triggers,
    skipped,
    unknownPaths,
  };
}

function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const m = a.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
    }),
  );

  const base = args.base || 'origin/main';
  const asJson = args.json === true;

  const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

  let changedFiles;
  try {
    changedFiles = sh(`git diff --name-only ${base}...HEAD`)
      .split('\n')
      .filter(Boolean);
  } catch (err) {
    console.error(`[detect-deploy-needed] git diff failed against base '${base}': ${err.message}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    console.log('deploy=false');
    console.log('reason=no changes vs base');
    console.log('services=');
    process.exit(10);
  }

  const { deploy: deployNeeded, services: pathServices, triggers, skipped, unknownPaths } = classifyChanges(changedFiles);

  // True-affected resolver: map the diff to its dependent DEPLOYABLE service
  // closure (covers shared-lib changes, which path-extraction leaves empty).
  // Exclude no-deploy (Tier 0) files so a tools/ or docs/ edit never widens it.
  let services = pathServices;
  if (deployNeeded) {
    try {
      const graph = loadGraph();
      const deployRelevant = changedFiles.filter((f) => !TIER0.some((re) => re.test(f)));
      services = affectedProjects(graph, { files: deployRelevant, type: 'app' })
        .filter((n) => graph.nodes[n].data.root.startsWith('services/'));
    } catch (err) {
      console.error(`[detect-deploy] resolver unavailable (${err.message}); using path-extracted services`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify({
      deploy: deployNeeded,
      services,
      triggers,
      skipped,
      unknownPaths,
      base,
      changedCount: changedFiles.length,
    }, null, 2));
  } else {
    console.log(`deploy=${deployNeeded}`);
    console.log(`services=${services.join(',')}`);
    console.log(`reason=${
      triggers.length > 0
        ? `${triggers.length} deploy-required file(s)`
        : unknownPaths.length > 0
          ? `${unknownPaths.length} unknown path(s) — conservative default`
          : 'all changes Tier 0'
    }`);

    if (triggers.length > 0) {
      console.log('\nTriggers (Tier 1):');
      for (const t of triggers) console.log(`  ${t.file} → ${t.reason}`);
    }
    if (unknownPaths.length > 0) {
      console.log('\nUnknown paths (defaulted to deploy=true):');
      for (const f of unknownPaths) console.log(`  ${f}`);
      console.log('  → consider adding to deploy-paths.md');
    }
    if (skipped.length > 0 && (triggers.length > 0 || unknownPaths.length > 0)) {
      console.log(`\nSkipped (Tier 0, no-deploy): ${skipped.length} file(s)`);
    } else if (skipped.length > 0) {
      console.log('\nAll changes Tier 0 (no-deploy):');
      for (const s of skipped) console.log(`  ${s.file}`);
    }
  }

  process.exit(deployNeeded ? 0 : 10);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
