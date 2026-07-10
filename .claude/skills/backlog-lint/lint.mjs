#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadBacklogFiles } from './lib/frontmatter.mjs';
import {
  ruleFrontmatterParseable, ruleItemSchemaValid,
  ruleIdMatchesFilename, ruleSingleActive, ruleQueuedRanks,
  ruleActiveOutOfScope, ruleShippedValidationGate, ruleReferencesValid,
  rulePromotionTriggerGated, ruleActiveEpicFields, ruleEpicClosure,
  ruleEpicPointerIntegrity, ruleSingleActiveEpic, epicCapturedAudit,
} from './lib/rules.mjs';
import { renderIndex, ruleIndexMatches } from './lib/index-render.mjs';
import { syncDossiers } from './lib/dossier-sync.mjs';

const REPO_ROOT = execSync('git rev-parse --show-toplevel').toString().trim();
const BACKLOG_DIR = join(REPO_ROOT, 'docs/backlog');
const BACKLOG_INDEX = join(REPO_ROOT, 'docs/BACKLOG.md');
const MEMORY_DIR = process.env.NESTFOLIO_MEMORY_DIR
  ?? join(process.env.HOME, '.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory');

function main() {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');

  if (!existsSync(BACKLOG_DIR)) {
    if (fix) mkdirSync(BACKLOG_DIR, { recursive: true });
    else { console.error(`docs/backlog/ missing — run with --fix to create`); process.exit(1); }
  }

  const files = loadBacklogFiles(BACKLOG_DIR);

  if (fix) {
    writeFileSync(BACKLOG_INDEX, renderIndex(files));
    if (existsSync(MEMORY_DIR)) syncDossiers(files, MEMORY_DIR);
    else console.warn(`[backlog-lint] memory dir not found at ${MEMORY_DIR} — skipping dossier sync`);
  }

  const violations = [];
  for (const f of files) {
    violations.push(...ruleFrontmatterParseable(f));
    violations.push(...ruleItemSchemaValid(f));
    violations.push(...ruleIdMatchesFilename(f));
    violations.push(...ruleActiveOutOfScope(f));
    violations.push(...ruleShippedValidationGate(f));
    violations.push(...ruleReferencesValid(f, REPO_ROOT));
    violations.push(...rulePromotionTriggerGated(f));
    violations.push(...ruleActiveEpicFields(f));
    violations.push(...ruleEpicClosure(f, files));
    violations.push(...ruleEpicPointerIntegrity(f, files));
  }
  violations.push(...ruleSingleActive(files));
  violations.push(...ruleQueuedRanks(files));
  violations.push(...ruleSingleActiveEpic(files));
  violations.push(...ruleIndexMatches(files, BACKLOG_INDEX));

  // Close-ritual aid: surface open captured members of any active epic so the
  // ship-time captured audit (CLAUDE.md § close ritual) cannot skip them.
  // Advisory, never a violation — load-bearing-ness is the agent's judgment.
  for (const a of epicCapturedAudit(files)) {
    console.log(`ℹ captured audit — active epic "${a.epic}" has ${a.members.length} open captured member(s); re-test each against done_when before ship (promote load-bearing ones to core):`);
    for (const m of a.members) console.log(`    · ${m}`);
  }

  if (violations.length > 0) {
    console.error(`✗ ${violations.length} violation(s):`);
    for (const v of violations) console.error(`  [${v.rule}] ${v.message}`);
    process.exit(1);
  }
  console.log(`✓ ${files.length} backlog files; all 11 rules pass${fix ? ' (with --fix applied)' : ''}`);
}

main();
