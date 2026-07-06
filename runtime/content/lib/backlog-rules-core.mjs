// runtime/content/lib/backlog-rules-core.mjs — zero-arg cores wrapping the backlog-lint rules for the
// runtime `module:` seam. DELEGATES to rules.mjs / index-render.mjs (single source of truth) — never forks.
// Each backlog rule is a whole-repo invariant (a violation is wrong regardless of what is staged).
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { loadBacklogFiles } from '../../../.claude/skills/backlog-lint/lib/frontmatter.mjs';
import {
  ruleFrontmatterParseable, ruleSingleActive, rulePromotionTriggerGated,
  ruleQueuedRanks, ruleActiveOutOfScope, ruleShippedValidationGate,
  ruleReferencesValid, ruleActiveEpicFields, ruleEpicClosure,
  ruleEpicPointerIntegrity, ruleSingleActiveEpic,
} from '../../../.claude/skills/backlog-lint/lib/rules.mjs';
import { ruleIndexMatches } from '../../../.claude/skills/backlog-lint/lib/index-render.mjs';

const repoRoot = () => execSync('git rev-parse --show-toplevel').toString().trim();
// Resolve the backlog dir + index to ABSOLUTE paths at module load (mirrors lint.mjs's REPO_ROOT). ruleIndexMatches
// resolves "Recently Shipped" git dates via an absolute-path-keyed map, so a relative DIR/INDEX yields a
// false-positive "BACKLOG.md out of date" on the clean backlog when the export is called zero-arg from the gate.
const ROOT = repoRoot();
const DIR = join(ROOT, 'docs/backlog');
const INDEX = join(ROOT, 'docs/BACKLOG.md');

// map backlog-lint violations ({rule,file,message}) → runtime findings ({detail,scope,evidence?})
const toFindings = (violations, scope = ['docs/backlog/*.md']) =>
  violations.map((v) => (v.file ? { detail: v.message, scope, evidence: v.file }
                                : { detail: v.message, scope }));

// arity adapters — all return zero-arg (dir-defaulted) cores the runtime can call with no args
const perFile        = (rule) => (dir = DIR) => toFindings(loadBacklogFiles(dir).flatMap(rule));
const wholeSet       = (rule) => (dir = DIR) => toFindings(rule(loadBacklogFiles(dir)));
const perFileWithAll = (rule) => (dir = DIR) => { const fs = loadBacklogFiles(dir); return toFindings(fs.flatMap((f) => rule(f, fs))); };
const perFileWithRoot = (rule) => (dir = DIR, root = ROOT) => toFindings(loadBacklogFiles(dir).flatMap((f) => rule(f, root)));

// ── per-file rules (this task) ──
export const frontmatterParseableViolations = perFile(ruleFrontmatterParseable);
export const activeOutOfScopeViolations      = perFile(ruleActiveOutOfScope);       // rule 4
export const activeEpicFieldsViolations      = perFile(ruleActiveEpicFields);       // rule 4a
export const shippedValidationGateViolations = perFile(ruleShippedValidationGate);  // rule 5
export const promotionTriggerGatedViolations = perFile(rulePromotionTriggerGated);  // rule 8

// ── whole-set / cross-file / root / index rules (this task) ──
export const singleActiveViolations         = wholeSet(ruleSingleActive);          // rule 2
export const referencesValidViolations      = perFileWithRoot(ruleReferencesValid); // rule 3
export const queuedRanksViolations           = wholeSet(ruleQueuedRanks);           // rule 6
export const epicClosureViolations           = perFileWithAll(ruleEpicClosure);     // rule 9
export const epicPointerIntegrityViolations  = perFileWithAll(ruleEpicPointerIntegrity); // rule 10
export const singleActiveEpicViolations      = wholeSet(ruleSingleActiveEpic);      // rule 11
export const indexMatchesViolations = (dir = DIR, indexPath = INDEX) =>
  toFindings(ruleIndexMatches(loadBacklogFiles(dir), indexPath), ['docs/BACKLOG.md']);
