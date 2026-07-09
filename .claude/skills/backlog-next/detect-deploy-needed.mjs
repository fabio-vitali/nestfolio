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
  // Test-only harness libs: NOT compiled into any deployed bundle. A change here
  // requires NO deploy and must NOT seed the true-affected resolver (else a one-line
  // harness edit fans out to its whole ~27-service consumer closure — the F-1 bug).
  { re: /^libs\/test-support\//,                reason: 'integ-test harness',  service: false, noRuntimeDeploy: true },
  { re: /^libs\/integration-testing\//,         reason: 'integ-test harness',  service: false, noRuntimeDeploy: true },
  // Frontend apps + libs. (investor-web lives under services/ and is matched by the
  // services rule above.) The MFEs deploy via their own `deploy-mfe` target; the host
  // shell bundle + the federation singleton lib have no independent deploy target and
  // are uploaded by `investor-web:deploy-shell` — see DEPLOY_VIA, applied at
  // deploy-target resolution since the nx graph has no import edge for that coupling.
  { re: /^apps\/[^/]+-mfe\//,                   reason: 'frontend MFE',        service: false },
  { re: /^apps\/nestfolio-host\//,              reason: 'frontend shell host', service: false },
  { re: /^libs\/ui\//,                          reason: 'frontend lib',        service: false },
  { re: /^libs\/frontend-deps\//,               reason: 'frontend lib',        service: false },
  { re: /^libs\/shell\//,                       reason: 'frontend lib',        service: false },
];

// Tier 0 — never deploy.
export const TIER0 = [
  // Per-service tests never compile into a deployed bundle, so a test-only service
  // change requires NO deploy and must NOT seed the true-affected resolver. The
  // `/test/` segment is the 3rd path component (after domain + service); the TIER1
  // service rules only match /src/, /infrastructure/, /domain/, so test paths fall
  // through to here. (Anchored on the directory segment, so a `src/**/*.test-helpers.ts`
  // runtime helper stays Tier 1.)
  /^services\/[^/]+\/[^/]+\/test\//,
  /^apps\/e2e-feature-tests\//,
  /^apps\/nestfolio-e2e\//,
  /^docs\//,
  /^flows\//,
  /^\.claude\//,
  /^tools\//,           // tools/*.mjs = repo tooling, never a deploy artifact
  /^scripts\//,         // root scripts/ = build/verify/benchmark tooling (benchmark-agents, backlog-regression, assert-shell-html, …) — never a deploy artifact. (Deploy scripts live under infrastructure/scripts, matched by the TIER1 infrastructure/** rule.)
  /^runtime\//,         // Long-Horizon Engineering Runtime (ring-1 engine + content ring) = pure node library run by `node --test`, no CDK stack/Lambda/service; never a deploy artifact
  /^\.github\//,        // CI workflow / scripts config, never a deploy artifact

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
  const seedFiles = []; // real-deploy-relevant files that seed the true-affected resolver

  for (const file of changedFiles) {
    let matched = false;
    for (const rule of TIER1) {
      const m = file.match(rule.re);
      if (m) {
        const noRuntimeDeploy = rule.noRuntimeDeploy === true;
        triggers.push({ file, reason: rule.reason, noRuntimeDeploy });
        if (rule.service) servicesSet.add(m[1]);
        if (!noRuntimeDeploy) seedFiles.push(file);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    if (ROOT_DEPLOY.some((re) => re.test(file))) {
      triggers.push({ file, reason: 'workspace-wide config', noRuntimeDeploy: false });
      seedFiles.push(file);
      continue;
    }

    if (TIER0.some((re) => re.test(file))) {
      skipped.push({ file, reason: 'no-deploy path' });
      continue;
    }

    unknownPaths.push(file);
    seedFiles.push(file); // unknown path → conservative deploy, seeds the resolver
  }

  // A deploy is required only if some trigger is a REAL (runtime-deployed) trigger,
  // or an unknown path forces the conservative default. A change touching ONLY
  // noRuntimeDeploy harness libs requires no deploy (deploy=false).
  const deploy = triggers.some((t) => !t.noRuntimeDeploy) || unknownPaths.length > 0;
  return {
    deploy,
    services: [...servicesSet].sort(),
    triggers,
    skipped,
    unknownPaths,
    seedFiles,
  };
}

// CLI exit-code contract. This is the deterministic SEAM the /backlog-next closing
// phase (Step 6.3) routes on: exit 0 ⇒ deploy needed ⇒ route to the deploy + e2e
// validation gate before ship; exit 10 ⇒ no deploy ⇒ skip 6.4 (doc-derivation / ship
// close). The exit code is a pure function of `deploy` — it never depends on the
// nx-graph resolver (whose failure is caught and falls back without changing it).
// Extracted as a pure export so the contract is unit-testable without git or nx
// (bef-closing-detector-live-coverage-gap: the live corpus can't gate the model's
//  routing under headless `claude -p`, but this exit-code seam it reads can be unit-gated).
export const DEPLOY_EXIT = { NEEDED: 0, NONE: 10 };
export const deployExitCode = (deployNeeded) =>
  deployNeeded ? DEPLOY_EXIT.NEEDED : DEPLOY_EXIT.NONE;

// Deploy-time couplings the nx graph cannot express (no import edge). The shell
// host bundle (nestfolio-host) and the Native-Federation singleton surface
// (frontend-deps) have no independent deploy target — they are built and uploaded
// by `investor-web:deploy-shell` (deploy.sh Phase 4c). A change to either must
// therefore (re)deploy investor-web. Keyed by nx project name.
export const DEPLOY_VIA = {
  'nestfolio-host': 'investor-web',
  'frontend-deps': 'investor-web',
};

/**
 * Map real-deploy seed files to the `deploy.sh --services=` tokens that actually
 * (re)deploy the affected code. Runs the true-affected resolver to get the full
 * dependent project closure, then keeps only projects that are independently
 * deployable (have a `deploy` or `deploy-mfe` nx target), remapping the
 * graph-invisible shell-bundle projects through DEPLOY_VIA. Non-deployable
 * projects (intermediate libs, e2e harness apps, the host shell itself) are
 * dropped or remapped — never emitted raw, so `--services=` is always trustworthy.
 */
export function resolveDeployServices(graph, seedFiles) {
  const tokens = new Set();
  for (const proj of affectedProjects(graph, { files: seedFiles })) {
    const targets = graph.nodes[proj]?.data?.targets || {};
    if (targets.deploy != null || targets['deploy-mfe'] != null) {
      tokens.add(proj);
    } else if (DEPLOY_VIA[proj]) {
      tokens.add(DEPLOY_VIA[proj]);
    }
    // else: not independently deployable and no coupling → drop
  }
  return [...tokens].sort();
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
    process.exit(DEPLOY_EXIT.NONE);
  }

  const { deploy: deployNeeded, services: pathServices, triggers, skipped, unknownPaths, seedFiles } = classifyChanges(changedFiles);

  // True-affected resolver: map the real-deploy seed files (TIER0 + noRuntimeDeploy
  // harness libs already excluded by classifyChanges) to their dependent DEPLOYABLE
  // project closure, keeping only independently-deployable apps and remapping the
  // graph-invisible shell-bundle projects through DEPLOY_VIA. Covers shared-lib and
  // frontend changes, which bare path-extraction leaves empty.
  let services = pathServices;
  if (deployNeeded) {
    try {
      const graph = loadGraph();
      services = resolveDeployServices(graph, seedFiles);
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

  process.exit(deployExitCode(deployNeeded));
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
