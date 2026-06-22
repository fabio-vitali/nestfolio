import { readFileSync, existsSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

const v = (rule, file, message) => ({ rule, file: file?.filename ?? null, message });

// ── Epic helpers ──────────────────────────────────────────────────────────
// An epic is a `type: epic` file. Members point at it via `epic: <epic-id>`
// (single-parent tree). A member's `epic_role` is `core` (drives closure) or
// `captured` (rides along, never blocks closure). Default role is `core`.
export const TERMINAL = new Set(['shipped', 'dropped']);
export const isEpic = (f) => f.frontmatter?.type === 'epic';
export const epicRole = (f) => f.frontmatter?.epic_role ?? 'core';
export const membersOf = (epicId, files) =>
  files.filter(f => f.frontmatter?.epic === epicId);

// Structural precondition gate (NOT a numbered rule): a file whose YAML frontmatter
// could not be parsed is reported located-by-filename, so a malformed file never
// crashes the run unlocated. Relies on loadBacklogFiles' total parseError field.
export function ruleFrontmatterParseable(file) {
  if (file.parseError) {
    return [v('frontmatter-parseable', file,
      `${file.filename}: malformed YAML frontmatter — ${file.parseError}`)];
  }
  return [];
}

export function ruleIdMatchesFilename(file) {
  const expected = file.filename.replace(/\.md$/, '');
  if (file.frontmatter?.id !== expected) {
    return [v('id-matches-filename', file,
      `frontmatter id "${file.frontmatter?.id}" does not match filename "${file.filename}"`)];
  }
  return [];
}

export function ruleSingleActive(files) {
  // Rule 2: at most one active *executable* (non-epic) workstream. Epics have
  // their own single-active rule (rule 11) so a delivery epic + the one member
  // being worked inside it are both allowed.
  const active = files.filter(f => f.frontmatter?.status === 'active' && !isEpic(f));
  if (active.length > 1) {
    const ids = active.map(f => f.id).join(', ');
    return [v('single-active', null, `multiple non-epic files with status: active — ${ids}`)];
  }
  return [];
}

export function rulePromotionTriggerGated(file) {
  if (file.frontmatter?.status !== 'queued') return [];
  // Scan BOTH the notes: frontmatter AND the body — trigger language in notes
  // escapes a body-only scan and silently keeps an unmet item queued.
  const text = `${file.frontmatter?.notes ?? ''}\n${file.body ?? ''}`;
  const m = text.match(/\bPromote\s+(when|on|once|until|after|only)\b[^.\n]*/i);
  if (m) {
    return [v('promotion-trigger-gated', file,
      `${file.id}: queued but notes/body has unmet promotion trigger — "${m[0].trim()}". Either remove the sentence (trigger fired — document why) or revert to status: parking.`)];
  }
  return [];
}

export function ruleQueuedRanks(files) {
  const queued = files.filter(f => f.frontmatter?.status === 'queued');
  const violations = [];
  const seenRanks = new Map();
  for (const f of queued) {
    const r = f.frontmatter.rank;
    if (r == null) {
      violations.push(v('queued-rank', f, `${f.id}: queued item missing rank`));
    } else if (seenRanks.has(r)) {
      violations.push(v('queued-rank', f,
        `${f.id}: duplicate rank ${r} (also on ${seenRanks.get(r)})`));
    } else {
      seenRanks.set(r, f.id);
    }
  }
  return violations;
}

export function ruleActiveOutOfScope(file) {
  if (file.frontmatter?.status !== 'active') return [];
  const oos = file.frontmatter.out_of_scope;
  if (!Array.isArray(oos) || oos.length === 0) {
    return [v('active-out-of-scope', file,
      `${file.id}: active item — out_of_scope is empty (rule 4)`)];
  }
  return [];
}

export function ruleShippedValidationGate(file) {
  if (file.frontmatter?.status !== 'shipped') return [];
  const gate = file.frontmatter.validation_gate;
  if (typeof gate !== 'string' || gate.trim() === '') {
    return [v('shipped-validation-gate', file,
      `${file.id}: shipped item — validation_gate is empty (rule 5)`)];
  }
  return [];
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');
}

// Extract markdown ATX-heading slugs, SKIPPING fenced code blocks — otherwise a
// `# shell comment` at column 0 inside a ```fence``` would falsely resolve a
// reference anchor (rule 3, false-positive resolution). Toggling on ``` / ~~~
// delimiters is sufficient for the spec/design docs this validates.
function extractHeadings(content) {
  const slugs = [];
  let inFence = false;
  for (const line of content.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^#+\s+(.+)$/);
    if (m) slugs.push(slugify(m[1]));
  }
  return slugs;
}

export function ruleReferencesValid(file, repoRoot) {
  if (!['design', 'spec'].includes(file.frontmatter?.type)) return [];
  const refs = file.frontmatter.references;
  if (!Array.isArray(refs) || refs.length === 0) {
    return [v('references-valid', file,
      `${file.id}: references are empty — ${file.frontmatter.type} type requires references (rule 3)`)];
  }
  const violations = [];
  for (const ref of refs) {
    const [pathPart, anchor] = ref.split('#');
    const fullPath = isAbsolute(pathPart) ? pathPart : join(repoRoot, pathPart);
    if (!existsSync(fullPath)) {
      violations.push(v('references-valid', file,
        `${file.id}: reference path not found: ${pathPart}`));
      continue;
    }
    if (anchor) {
      const headings = extractHeadings(readFileSync(fullPath, 'utf8'));
      if (!headings.includes(anchor.toLowerCase())) {
        violations.push(v('references-valid', file,
          `${file.id}: anchor "#${anchor}" not found in ${pathPart}`));
      }
    }
  }
  return violations;
}

// Rule 4 (epic variant): an active delivery epic must declare its closure and
// absorption boundaries — done_when (closure narrative) + scope (what folds in
// as core). out_of_scope is enforced for all active items by ruleActiveOutOfScope.
export function ruleActiveEpicFields(file) {
  if (!isEpic(file) || file.frontmatter?.status !== 'active') return [];
  const violations = [];
  const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';
  if (!nonEmpty(file.frontmatter?.done_when)) {
    violations.push(v('active-epic-fields', file,
      `${file.id}: active epic — done_when is empty (rule 4)`));
  }
  if (!nonEmpty(file.frontmatter?.scope)) {
    violations.push(v('active-epic-fields', file,
      `${file.id}: active epic — scope is empty (rule 4)`));
  }
  return violations;
}

// Rule 9 (closure): a TERMINAL epic (shipped OR dropped) must have no member still
// pointing at it in a non-terminal state — otherwise the member is invisible to
// triage (a closed epic renders no rollup, and an epic-pointered member is not an
// orphan). Core members must be resolved/dropped (they define done); captured
// members must be resolved/dropped OR re-homed (e.g. to <epic>-leftovers). A
// member of a *dropped* epic whose work is still wanted is re-homed (repoint epic:
// at a live epic, or remove the pointer → standalone parking). Terminal members
// may keep pointing at the closed epic as provenance. (Dropped is included for
// symmetry: rule 9 used to guard only shipped, leaving dropped-epic members silent.)
export function ruleEpicClosure(file, files) {
  if (!isEpic(file) || !TERMINAL.has(file.frontmatter?.status)) return [];
  const epicStatus = file.frontmatter.status;
  const violations = [];
  for (const m of membersOf(file.id, files)) {
    if (TERMINAL.has(m.frontmatter?.status)) continue;
    const role = epicRole(m);
    const remedy = role === 'captured'
      ? `re-home it (e.g. to ${file.id}-leftovers, or remove the epic: pointer) or resolve/drop it`
      : `resolve or drop it, or re-home it (repoint epic: at a live epic / remove the pointer)`;
    violations.push(v('epic-closure', file,
      `${file.id}: ${epicStatus} epic has non-terminal ${role} member ${m.id} (status: ${m.frontmatter?.status}) — ${remedy} (rule 9)`));
  }
  return violations;
}

// Captured-member audit surface (close-ritual aid, NOT a hard rule). For each
// ACTIVE epic, list its still-open captured members so the ship-time audit
// (CLAUDE.md § "Closure & close ritual") cannot skip re-testing them against
// done_when before spin-out. Structural only: WHETHER a captured member is
// load-bearing is the agent's judgment — this guarantees none hide silently.
// Returns [{ epic, members: [id,...] }] for epics that have ≥1 such member.
export function epicCapturedAudit(files) {
  const notes = [];
  for (const e of files.filter(f => isEpic(f) && f.frontmatter?.status === 'active')) {
    const members = membersOf(e.id, files)
      .filter(m => epicRole(m) === 'captured' && !TERMINAL.has(m.frontmatter?.status))
      .map(m => m.id);
    if (members.length > 0) notes.push({ epic: e.id, members });
  }
  return notes;
}

// Rule 10 (pointer integrity): epic relational fields are well-formed.
//  - a member's `epic:` must reference an existing `type: epic` file
//  - an epic file must NOT carry an `epic:` pointer (1-level tree, no nesting)
//  - `epic_role`, when set, must be `core` or `captured`
export function ruleEpicPointerIntegrity(file, files) {
  const violations = [];
  const ep = file.frontmatter?.epic;
  if (isEpic(file) && ep != null) {
    violations.push(v('epic-pointer', file,
      `${file.id}: epic file must not carry an epic: pointer — no nested epics (rule 10)`));
  }
  if (ep != null && !isEpic(file)) {
    const target = files.find(f => f.id === ep);
    if (!target) {
      violations.push(v('epic-pointer', file,
        `${file.id}: epic: "${ep}" references a non-existent backlog file (rule 10)`));
    } else if (!isEpic(target)) {
      violations.push(v('epic-pointer', file,
        `${file.id}: epic: "${ep}" points at a non-epic file (type: ${target.frontmatter?.type ?? 'none'}) (rule 10)`));
    }
  }
  const role = file.frontmatter?.epic_role;
  if (role != null && !['core', 'captured'].includes(role)) {
    violations.push(v('epic-pointer', file,
      `${file.id}: epic_role "${role}" must be "core" or "captured" (rule 10)`));
  }
  return violations;
}

// Rule 11 (single active epic): at most one delivery epic in flight at a time.
// Theme epics (status: parking) and scheduled epics (status: queued) are unbounded.
export function ruleSingleActiveEpic(files) {
  const active = files.filter(f => isEpic(f) && f.frontmatter?.status === 'active');
  if (active.length > 1) {
    return [v('single-active-epic', null,
      `multiple active epics — ${active.map(f => f.id).join(', ')} (rule 11)`)];
  }
  return [];
}
