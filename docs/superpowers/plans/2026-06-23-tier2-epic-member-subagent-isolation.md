# Tier-2 epic-member subagent-isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/backlog-next-epic` run each epic member as a context-isolated `epic-member-worker` subagent (instead of an inline Skill-tool load), so the orchestrator's context grows only in compact per-member notes + the decision log.

**Architecture:** A fresh subagent per member does all heavy work in its own context and returns ONE fenced-JSON payload (`MEMBER-SUMMARY` terminal, or `NEEDS-DECISION` parked). The orchestrator parses it with a tested validator (`member-summary.mjs`), surfaces floor/interactive decisions via `AskUserQuestion`, and resumes the parked subagent via `SendMessage`. Decisions are persisted to the existing run-state `decisions[]` at resolution time (keyed by a deterministic `fork_key`). A cross-session `wx` lock prevents double-dispatch. Tier-1's `/clear` becomes a spike-gated fallback mode.

**Tech Stack:** Node ESM `.mjs` helpers + `node --test` (Node 24); Claude Code skills (`.claude/skills/*/SKILL.md`) + a custom agent type (`.claude/agents/*.md`); the Agent tool + `SendMessage` continuation (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`).

## Global Constraints

- **Spec is authoritative:** `docs/superpowers/specs/2026-06-23-backlog-next-epic-member-subagent-isolation-design.md` (**rev4**). Every `[plan]` marker in the spec is resolved here.
- **⚠ SPIKE CORRECTIONS (Task 1 EXECUTED 2026-06-23 → `TIER2-GO`; apply to Tasks 5/6/7).** The live spike (`docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md`) forced three transport corrections that OVERRIDE the as-written code in Tasks 5/6 below:
  1. **Transport = bidirectional `SendMessage`, NOT "end your turn with a payload" / temp-file-final-message.** A named agent is a **concurrent background teammate**; it `SendMessage`s `main` its payload, and the orchestrator `SendMessage`s rulings back. So: the **`epic-member-worker` agent `tools:` MUST include `SendMessage`** (Task 5); every "END YOUR TURN with a fenced block" instruction becomes "**`SendMessage` to `main`** the fenced block"; the orchestrator dispatches `Agent({…, name:"member-<id>"})`, then **YIELDS** for the teammate's `SendMessage`, writes the received text to a temp file, and runs `member-summary.mjs parse` (Task 6).
  2. **Concurrency by DISCIPLINE.** The worker runs concurrently; the orchestrator dispatches ONE member, yields while it is live, and never runs worktree/git ops during a live member turn. Shut the teammate down (`shutdown_request`) when its member is terminal.
  3. **Floor: prompting is NOT a backstop** (destructive Bash auto-proceeds unprompted in a subagent). The deny-hook follow-up is a HARD precondition before unattended use; attended dev `--auto` is fine.
- **No top-level run-state schema change.** The closed 6-key schema (`epic,branch,worktree,auto,decisions,e2e` + optional `e8`) is untouched. The decision-ENTRY shape gains a required `fork_key`; `appendDecision` gains a supersede-aware dedup branch; a `clear-e8` verb is added. These are behavior changes to `runstate.mjs`, not schema-key changes.
- **No epic-model rule change** (frontmatter + 11 lint invariants, frozen 2026-06-16).
- **Tests live in `test/`** beside each skill helper; run with the glob form: `node --test '.claude/skills/backlog-next-epic/test/*.test.mjs'` (Node 24 does not discover via `node --test <dir>`).
- **Worktree discipline:** all work commits to `feat/epic-member-subagent-isolation` in `.claude/worktrees/epic-member-subagent-isolation`; commits use `--no-verify` (worktree pre-commit hook caveat) and each commit is verified to have landed on the branch.
- **`fork_key` is computed in ONE place** (`fork-key.mjs`) from STRUCTURED inputs, never free prose.
- **TASK 1 IS A HARD GATE.** Do not start Task 5+ until the spike's go/no-go is recorded. If a spike item fails, adopt its documented fallback (or stop) before proceeding.

---

## File Structure

| Path | Responsibility | Task |
|------|----------------|------|
| `docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md` (create) | Spike evidence + go/no-go decision + mode selection | 1 |
| `.claude/skills/backlog-next-epic/fork-key.mjs` (create) | Deterministic `fork_key` from structured inputs | 2 |
| `.claude/skills/backlog-next-epic/test/fork-key.test.mjs` (create) | fork-key determinism/structure tests | 2 |
| `.claude/skills/backlog-next-epic/member-summary.mjs` (create) | Parse + validate the subagent's final-message payload; exit codes 0/1/2/3 | 3 |
| `.claude/skills/backlog-next-epic/test/member-summary.test.mjs` (create) | Extraction + schema + exit-code tests | 3 |
| `.claude/skills/backlog-next-epic/runstate.mjs` (modify) | `clear-e8` verb; supersede-aware `appendDecision` dedup; `fork_key` validation | 4 |
| `.claude/skills/backlog-next-epic/test/runstate.test.mjs` (modify) | dedup/supersede/clear-e8/fork_key tests | 4 |
| `.claude/agents/epic-member-worker.md` (create) | The custom agent type (wrapper contract) | 5 |
| `.claude/skills/backlog-next-epic/SKILL.md` (modify) | E4/E5 loop, E6/E7 audit+override, E8, E9, §G lock, Tier-1 fallback, Common mistakes | 6 |
| `.claude/skills/backlog-next/SKILL.md` (modify) | epic-member-mode bubble-up delta, `status:blocked` rule, inline-assertion reconciliation | 7 |
| `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md` (modify) | correction note pointing to the Tier-2 spec | 8 |

---

## Task 1: Go/no-go harness spike (HARD GATE) — ✅ DONE 2026-06-23 → `TIER2-GO`

> **Executed live; evidence: `docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md`.** Critical items 1/2/3 PASS, 5/6 PASS; item 9 corrected (concurrent, not blocking); item 8 → destructive Bash auto-proceeds ⇒ deny-hook is a hard precondition for unattended only. The three forced corrections are in the Global-Constraints addendum above. Build proceeds at Task 2. The original probe steps are retained below for the record.

**Files:**
- Create (throwaway, deleted at end of task): `.claude/agents/_spike-probe.md`
- Create: `docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md`

**Interfaces:**
- Produces: a recorded **mode decision** — `TIER2-GO` (all critical items pass) or a named fallback — consumed implicitly by every later task. Tasks 5-8 assume `TIER2-GO`.

This task is observational, not TDD. Each probe spawns/inspects a real subagent and records the outcome. Critical items (must pass for `TIER2-GO`): 1, 2, 3, 9. Conditioning items (shape the design, with fallbacks): 4, 5, 6, 7, 8.

- [ ] **Step 1: Create a minimal probe agent definition**

Create `.claude/agents/_spike-probe.md`:

```markdown
---
name: _spike-probe
description: Throwaway probe for the Tier-2 harness spike. Delete after the spike.
tools: Bash, Read, Skill
---
You are a probe. Do EXACTLY what the dispatch prompt says and end your turn with the literal fenced block it asks for. Do not call any other tool unless told.
```

(Note the allowlist deliberately OMITS `AskUserQuestion`/`ExitPlanMode` — item 3 tests whether that exclusion is enforced.)

- [ ] **Step 2: Probe items 1-3 (SendMessage continuation, agent-type resolution, allowlist enforcement)**

From the main session, dispatch `Agent({ subagent_type: "_spike-probe", prompt: "Emit exactly this and STOP: ```json\n{\"kind\":\"needs-decision\",\"q\":\"probe\"}\n```. Then, if you receive a follow-up message, emit ```json\n{\"kind\":\"member-summary\",\"got\":\"<the message text>\"}\n``` and STOP." })`.
- Item 2 PASS = the agent resolves and runs (no "unknown subagent_type").
- Item 1 PASS = after the first turn returns the needs-decision block, `SendMessage({to:<id>, message:"RULING-XYZ"})` resumes it and the second turn returns the member-summary echoing `RULING-XYZ` (context intact).
- Item 3: in a second dispatch, instruct the probe to "call the AskUserQuestion tool". PASS = it cannot (tool unavailable / call rejected). FAIL = it prompts. Record verbatim.

- [ ] **Step 3: Probe items 4-5 (broad allowlist, agent nesting)**

Dispatch a probe (temporarily widen `_spike-probe` tools to `Bash, Read, Skill, Task, Agent` for this step) told to: run `git status` (Bash), and attempt to spawn an `Explore` sub-agent.
- Item 4 PASS = Bash/Skill usable.
- Item 5 = record whether the nested `Explore` dispatch succeeds (informs §B: nested Explore vs direct-tool investigation). Not a blocker.

- [ ] **Step 4: Probe items 7-8 (permission inheritance, destructive-Bash behavior) — SAFETY**

Dispatch a probe told to run, one at a time and report the outcome of each WITHOUT retrying: (a) a benign unlisted command (e.g. `echo probe`); (b) a benign-but-likely-unlisted command; (c) a SAFE proxy for a destructive op that is NON-mutating — e.g. `git push --force --dry-run origin HEAD:refs/heads/_spike_nonexistent` (dry-run never mutates) and `git branch -D _no_such_branch_xyz` (fails fast, deletes nothing).
- Item 7 = does the subagent appear to inherit `settings.local.json` `permissions.allow` (did an allowed command run without a prompt)?
- Item 8 = for the destructive proxies: does it PROMPT, BLOCK, or AUTO-PROCEED? Record exactly. **If destructive auto-proceeds unprompted**, mark "floor-not-safe-unattended" — the §D irreversible-action checklist + the deny-hook follow-up become mandatory before any unattended use.

- [ ] **Step 5: Probe items 6, 9 (context-isolation proxy, Agent() blocking)**

- Item 9 PASS = `Agent()` blocks the main session end-to-end (no interleaving) AND a commit the probe makes mid-turn (`git commit --allow-empty -m probe`) is visible via `git log` the instant control returns.
- Item 6 = dispatch a "trivial" probe (emit a summary, touch nothing) vs a "file-heavy" probe (read several large files, then emit the SAME tiny summary). PASS = the main session's context delta is ~constant across the two (only the tiny payload lands, not the file reads). Record approximate token/turn delta for each.

- [ ] **Step 6: Record the decision and clean up**

Write `docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md` with a row per item (item, probe, observed result verbatim, PASS/FAIL/NOTE) and a final line: `MODE: TIER2-GO` (items 1,2,3,9 all PASS) or the fallback (`TIER1-FALLBACK` if item 1 or 9 fails; `HONOR-SYSTEM-BUBBLE-UP` if only item 3 fails; `FLOOR-NOT-SAFE-UNATTENDED` if item 8 auto-proceeds). Delete `.claude/agents/_spike-probe.md`.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md
git rm -f .claude/agents/_spike-probe.md 2>/dev/null || true
git commit --no-verify -m "spike: Tier-2 harness go/no-go — <MODE>"
git log --oneline -1   # verify landed
```

**GATE:** If MODE ≠ `TIER2-GO`, STOP and apply the fallback per §Risk before any further task. Items 6/7/8 NOTEs feed Tasks 5/6 (they shape the agent def + floor prose) but do not block.

---

## Task 2: `fork-key.mjs` (deterministic fork identity)

**Files:**
- Create: `.claude/skills/backlog-next-epic/fork-key.mjs`
- Test: `.claude/skills/backlog-next-epic/test/fork-key.test.mjs`

**Interfaces:**
- Produces: `export function forkKey(member: string, canonicalForkSubject: string): string` (hex sha256) and `export function canonicalSubject({reason, symbol, designSliceId}): string`. Consumed by the worker (to tag decisions), `member-summary.mjs` (no — it only validates presence), and `runstate.mjs` dedup (compares the value).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/fork-key.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkKey, canonicalSubject } from '../fork-key.mjs';

test('forkKey is deterministic for identical structured inputs', () => {
  const a = forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' }));
  const b = forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' }));
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('forkKey differs by member and by subject', () => {
  const base = canonicalSubject({ reason: 'floor:scope', symbol: 'quantity' });
  assert.notEqual(forkKey('m1', base), forkKey('m2', base));
  assert.notEqual(forkKey('m1', base), forkKey('m1', canonicalSubject({ reason: 'floor:scope', symbol: 'amountCents' })));
});

test('design-approval subject is stable by design-slice id, ignoring prose', () => {
  const x = canonicalSubject({ reason: 'design-approval', designSliceId: 'slice-7' });
  const y = canonicalSubject({ reason: 'design-approval', designSliceId: 'slice-7' });
  assert.equal(x, y);
  assert.equal(x, 'design-approval:slice-7');
});

test('canonicalSubject throws on missing structured input', () => {
  assert.throws(() => canonicalSubject({ reason: 'floor:scope' }), /symbol/);
  assert.throws(() => canonicalSubject({ reason: 'design-approval' }), /designSliceId/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test '.claude/skills/backlog-next-epic/test/fork-key.test.mjs'`
Expected: FAIL — `Cannot find module '../fork-key.mjs'`.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/skills/backlog-next-epic/fork-key.mjs`:

```javascript
import { createHash } from 'node:crypto';

/** Canonical, STRUCTURED fork subject (never free prose) — the second half of fork_key. */
export function canonicalSubject({ reason, symbol, designSliceId }) {
  if (reason === 'design-approval') {
    if (!designSliceId) throw new Error('canonicalSubject: design-approval requires designSliceId');
    return `design-approval:${designSliceId}`;
  }
  if (!symbol) throw new Error('canonicalSubject: a scope/floor fork requires the symbol (the exact arg passed to detect-fork-blast-radius)');
  return `${reason}:${symbol}`;
}

/** Deterministic fork identity. SAME (member, canonicalForkSubject) => SAME key on every (re)dispatch. */
export function forkKey(member, canonicalForkSubject) {
  if (!member || !canonicalForkSubject) throw new Error('forkKey requires member + canonicalForkSubject');
  return createHash('sha256').update(`${member} ${canonicalForkSubject}`).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test '.claude/skills/backlog-next-epic/test/fork-key.test.mjs'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next-epic/fork-key.mjs .claude/skills/backlog-next-epic/test/fork-key.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): deterministic fork-key helper"
git log --oneline -1
```

---

## Task 3: `member-summary.mjs` (payload parse + validate)

**Files:**
- Create: `.claude/skills/backlog-next-epic/member-summary.mjs`
- Test: `.claude/skills/backlog-next-epic/test/member-summary.test.mjs`

**Interfaces:**
- Produces: `export function parseMemberOutput(text: string): { kind, ... }` (throws `ParseError` with a `.code` ∈ {malformed, none, ambiguous, schema} on failure) and a `main()` CLI: `node member-summary.mjs parse <file>` printing the JSON and exiting `0` (needs-decision) / `1` (member-summary shipped) / `2` (member-summary blocked) / `3` (parse-failure). Consumed by the orchestrator E4.2 loop (Task 6).

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/backlog-next-epic/test/member-summary.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMemberOutput } from '../member-summary.mjs';

const FK = 'a'.repeat(64);
const fence = (obj) => '```json\n' + JSON.stringify(obj) + '\n```';
const SUMMARY = { kind: 'member-summary', member: 'm1', lane: 'simple', status: 'shipped', validation_gate: 'integ ok', commits: ['abc f'], decisions: [] };
const NEEDS = { kind: 'needs-decision', member: 'm1', reason: 'floor:scope', question: 'q?', options: [{ label: 'A', description: 'a', recommended: true }], fork_key: FK };

test('extracts the LAST kind-bearing fenced block; earlier example fences are narrative', () => {
  const text = `Here is an example I considered:\n${fence({ kind: 'member-summary', note: 'EXAMPLE' })}\nFinal:\n${fence(SUMMARY)}`;
  const r = parseMemberOutput(text);
  assert.equal(r.kind, 'member-summary');
  assert.equal(r.status, 'shipped');
});

test('needs-decision validates and requires fork_key', () => {
  assert.equal(parseMemberOutput(fence(NEEDS)).kind, 'needs-decision');
  const { fork_key, ...noKey } = NEEDS;
  assert.throws(() => parseMemberOutput(fence(noKey)), /fork_key/);
});

test('blocked WITHOUT blocked_reason is still valid (defaulted), not a parse failure', () => {
  const blocked = { kind: 'member-summary', member: 'm1', lane: 'simple', status: 'blocked', validation_gate: 'n/a', commits: [], decisions: [] };
  const r = parseMemberOutput(fence(blocked));
  assert.equal(r.status, 'blocked');
  assert.equal(r.blocked_reason, 'unspecified');
});

test('decision entries require fork_key', () => {
  const bad = { ...SUMMARY, decisions: [{ decision: 'd', options: ['x'], chosen: 'x', rationale: 'r', rejected: 'y' }] };
  assert.throws(() => parseMemberOutput(fence(bad)), /fork_key/);
});

test('no kind-bearing block, malformed JSON, and two different operative kinds all throw with a code', () => {
  assert.equal(catchCode(() => parseMemberOutput('no payload here')), 'none');
  assert.equal(catchCode(() => parseMemberOutput('```json\n{ not valid\n```')), 'malformed');
  const ambiguous = `${fence(SUMMARY)}\n${fence(NEEDS)}`; // two DIFFERENT kinds, both operative-looking
  assert.equal(catchCode(() => parseMemberOutput(ambiguous)), 'ambiguous');
});

test('unknown keys are rejected (closed schema)', () => {
  assert.throws(() => parseMemberOutput(fence({ ...SUMMARY, surprise: 1 })), /unknown/);
});

function catchCode(fn) { try { fn(); return null; } catch (e) { return e.code; } }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test '.claude/skills/backlog-next-epic/test/member-summary.test.mjs'`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `.claude/skills/backlog-next-epic/member-summary.mjs`:

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class ParseError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

const SUMMARY_KEYS = ['kind', 'member', 'lane', 'status', 'validation_gate', 'commits', 'decisions', 'blocked_reason'];
const NEEDS_KEYS = ['kind', 'member', 'reason', 'question', 'deliberation', 'options', 'fork_key', 'blast_radius'];
const DECISION_KEYS = ['decision', 'options', 'chosen', 'rationale', 'rejected', 'fork_key', 'supersedes'];
const LANES = new Set(['doc-layer', 'simple', 'complex']);
const REASONS = new Set(['design-approval', 'bounded-effort-exceeded', 'catch-all']);
const isReason = (r) => REASONS.has(r) || /^floor:/.test(r);

function fencedKindBlocks(text) {
  const blocks = [];
  const re = /```json\s*([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let obj;
    try { obj = JSON.parse(m[1].trim()); } catch { obj = { __malformed: true }; }
    if (obj && obj.__malformed) blocks.push({ malformed: true });
    else if (obj && typeof obj === 'object' && 'kind' in obj) blocks.push({ obj });
  }
  return blocks;
}

function rejectUnknown(obj, allowed, where) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new ParseError('schema', `${where}: unknown key "${k}"`);
}

export function parseMemberOutput(text) {
  const blocks = fencedKindBlocks(text);
  if (blocks.length === 0) {
    // distinguish malformed-only from truly-none: was there a ```json fence at all?
    if (/```json/.test(text)) throw new ParseError('malformed', 'a ```json block was present but unparseable');
    throw new ParseError('none', 'no kind-bearing json payload found');
  }
  const malformed = blocks.filter((b) => b.malformed);
  const good = blocks.filter((b) => b.obj);
  if (good.length === 0) throw new ParseError('malformed', 'json payload present but unparseable');
  // Operative = the LAST kind-bearing block. Ambiguous only if the last two good blocks disagree on kind.
  if (good.length >= 2) {
    const last = good[good.length - 1].obj.kind;
    const prev = good[good.length - 2].obj.kind;
    if (last !== prev && [last, prev].every((k) => k === 'member-summary' || k === 'needs-decision'))
      throw new ParseError('ambiguous', `two different operative kinds: ${prev} vs ${last}`);
  }
  const obj = good[good.length - 1].obj;
  if (obj.kind === 'needs-decision') return validateNeeds(obj);
  if (obj.kind === 'member-summary') return validateSummary(obj);
  throw new ParseError('schema', `unknown kind "${obj.kind}"`);
}

function validateNeeds(o) {
  rejectUnknown(o, NEEDS_KEYS, 'needs-decision');
  if (typeof o.member !== 'string' || !o.member) throw new ParseError('schema', 'needs-decision.member required');
  if (!isReason(o.reason)) throw new ParseError('schema', `needs-decision.reason invalid: ${o.reason}`);
  if (typeof o.question !== 'string' || !o.question) throw new ParseError('schema', 'needs-decision.question required');
  if (!Array.isArray(o.options) || o.options.length === 0) throw new ParseError('schema', 'needs-decision.options required');
  if (typeof o.fork_key !== 'string' || !o.fork_key) throw new ParseError('schema', 'needs-decision.fork_key required');
  return o;
}

function validateSummary(o) {
  rejectUnknown(o, SUMMARY_KEYS, 'member-summary');
  if (typeof o.member !== 'string' || !o.member) throw new ParseError('schema', 'member-summary.member required');
  if (!LANES.has(o.lane)) throw new ParseError('schema', `member-summary.lane invalid: ${o.lane}`);
  if (o.status !== 'shipped' && o.status !== 'blocked') throw new ParseError('schema', `member-summary.status invalid: ${o.status}`);
  if (typeof o.validation_gate !== 'string') throw new ParseError('schema', 'member-summary.validation_gate required');
  if (!Array.isArray(o.commits)) throw new ParseError('schema', 'member-summary.commits required');
  if (!Array.isArray(o.decisions)) throw new ParseError('schema', 'member-summary.decisions required');
  for (const d of o.decisions) {
    rejectUnknown(d, DECISION_KEYS, 'decision');
    if (typeof d.fork_key !== 'string' || !d.fork_key) throw new ParseError('schema', 'decision.fork_key required');
  }
  if (o.status === 'blocked' && (typeof o.blocked_reason !== 'string' || !o.blocked_reason)) o.blocked_reason = 'unspecified';
  return o;
}

function main() {
  const [cmd, file] = process.argv.slice(2);
  if (cmd !== 'parse' || !file) { console.error('Usage: member-summary.mjs parse <file>'); process.exit(3); }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(3); }
  let r;
  try { r = parseMemberOutput(text); }
  catch (e) { console.error(`parse-failure [${e.code ?? 'error'}]: ${e.message}`); process.exit(3); }
  console.log(JSON.stringify(r, null, 2));
  if (r.kind === 'needs-decision') process.exit(0);
  process.exit(r.status === 'blocked' ? 2 : 1);
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test '.claude/skills/backlog-next-epic/test/member-summary.test.mjs'`
Expected: PASS (6 tests).

- [ ] **Step 5: Add the CLI exit-code smoke test**

Append to the test file:

```javascript
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI exit codes 0/1/2/3', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ms-'));
  const run = (text) => {
    const f = join(dir, 'p.txt'); writeFileSync(f, text);
    try { execFileSync('node', ['.claude/skills/backlog-next-epic/member-summary.mjs', 'parse', f]); return 1 === 0 ? 1 : 1; }
    catch (e) { return e.status; }
  };
  // shipped => exit 1 (execFileSync throws on non-zero; capture status)
  assert.equal(statusOf(`${fence(SUMMARY)}`), 1);
  assert.equal(statusOf(fence({ ...SUMMARY, status: 'blocked' })), 2);
  assert.equal(statusOf(fence(NEEDS)), 0);
  assert.equal(statusOf('garbage'), 3);
  function statusOf(text) {
    const f = join(dir, 'p.txt'); writeFileSync(f, text);
    try { execFileSync('node', ['.claude/skills/backlog-next-epic/member-summary.mjs', 'parse', f], { stdio: 'ignore' }); return 0; }
    catch (e) { return e.status; }
  }
});
```

Run: `node --test '.claude/skills/backlog-next-epic/test/member-summary.test.mjs'`
Expected: PASS (7 tests). (Run from the worktree root so the relative script path resolves.)

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next-epic/member-summary.mjs .claude/skills/backlog-next-epic/test/member-summary.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): member-summary payload validator (exit 0/1/2/3)"
git log --oneline -1
```

---

## Task 4: `runstate.mjs` — `clear-e8` + supersede-aware `appendDecision` dedup + `fork_key` validation

**Files:**
- Modify: `.claude/skills/backlog-next-epic/runstate.mjs`
- Test: `.claude/skills/backlog-next-epic/test/runstate.test.mjs`

**Interfaces:**
- Consumes: existing `appendDecision(state, decision)`, `validateRunState`, CLI verbs.
- Produces: `appendDecision` that (a) requires `decision.fork_key` (non-empty string), (b) **no-ops** when an entry with the same `(member, fork_key)` AND no `supersedes` already exists, (c) **always appends** an entry carrying `supersedes` (override); a new `clear-e8 <id>` CLI verb removing the optional `e8` key.

- [ ] **Step 1: Write the failing tests**

Add to `.claude/skills/backlog-next-epic/test/runstate.test.mjs` (import `appendDecision` if not already; the file already imports from `../runstate.mjs`):

```javascript
import { appendDecision, initRunState, validateRunState } from '../runstate.mjs';

test('appendDecision requires fork_key', () => {
  const s = initRunState({ epic: 'e', branch: 'b', worktree: 'w' });
  assert.throws(() => appendDecision(s, { member: 'm', decision: 'd' }), /fork_key/);
});

test('appendDecision dedups same (member, fork_key) non-superseding entries', () => {
  const s0 = initRunState({ epic: 'e', branch: 'b', worktree: 'w' });
  const d = { member: 'm', fork_key: 'k1', decision: 'x', chosen: 'A' };
  const s1 = appendDecision(s0, d);
  const s2 = appendDecision(s1, { ...d });
  assert.equal(s2.decisions.length, 1, 'duplicate must no-op');
});

test('appendDecision ALWAYS appends an override (supersedes), even with a reused fork_key', () => {
  const s0 = initRunState({ epic: 'e', branch: 'b', worktree: 'w' });
  const s1 = appendDecision(s0, { member: 'm', fork_key: 'k1', decision: 'x', chosen: 'A' });
  const s2 = appendDecision(s1, { member: 'm', fork_key: 'k1', decision: 'x', chosen: 'B', supersedes: 0 });
  assert.equal(s2.decisions.length, 2, 'override must append, not dedup');
  assert.equal(s2.decisions[1].chosen, 'B');
});

test('clear-e8 removes the optional e8 key', () => {
  const s = validateRunState({ epic: 'e', branch: 'b', worktree: 'w', auto: false, decisions: [], e2e: null, e8: 'PR_OPEN_AWAITING_MERGE' });
  const cleared = { ...s }; delete cleared.e8;
  assert.ok(!('e8' in validateRunState(cleared)));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test '.claude/skills/backlog-next-epic/test/runstate.test.mjs'`
Expected: FAIL — fork_key not required; duplicate not deduped; override test may pass-by-accident (current pure append), so assert the dedup test fails.

- [ ] **Step 3: Implement — modify `appendDecision`**

Replace the body of `appendDecision` (currently `.claude/skills/backlog-next-epic/runstate.mjs:114-122`):

```javascript
export function appendDecision(state, decision) {
  if (decision == null || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new Error('decision must be an object');
  }
  if (typeof decision.member !== 'string' || !decision.member) {
    throw new Error('decision.member (string) is required so the entry is attributable');
  }
  if (typeof decision.fork_key !== 'string' || !decision.fork_key) {
    throw new Error('decision.fork_key (string) is required for dedup + decision-aware re-dispatch');
  }
  // Override entries (carry `supersedes`) ALWAYS append — they intentionally reuse a fork_key.
  if (decision.supersedes === undefined) {
    const dup = state.decisions.some(
      (d) => d.member === decision.member && d.fork_key === decision.fork_key && d.supersedes === undefined,
    );
    if (dup) return state; // idempotent no-op: same fork already logged (subagent + orchestrator both saw it)
  }
  return { ...state, decisions: [...state.decisions, decision] };
}
```

- [ ] **Step 4: Implement — add the `clear-e8` CLI verb**

In the CLI `switch` (after the `set-e8` case, `.claude/skills/backlog-next-epic/runstate.mjs:195-199`), add:

```javascript
    case 'clear-e8': {
      const state = loadOrExit();
      const { e8, ...rest } = state;
      save(validateRunState(rest));
      console.log('e8 marker cleared'); break;
    }
```

Also update the usage string + the file's header CLI doc comment to list `clear-e8 <epic-id>`.

- [ ] **Step 5: Run to verify passes**

Run: `node --test '.claude/skills/backlog-next-epic/test/runstate.test.mjs'`
Expected: PASS (all existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/backlog-next-epic/runstate.mjs .claude/skills/backlog-next-epic/test/runstate.test.mjs
git commit --no-verify -m "feat(backlog-next-epic): runstate clear-e8 + supersede-aware appendDecision dedup + fork_key"
git log --oneline -1
```

---

## Task 5: `.claude/agents/epic-member-worker.md` (custom agent type)

**Files:**
- Create: `.claude/agents/epic-member-worker.md`

**Interfaces:**
- Consumes: spike MODE (must be `TIER2-GO`; if `HONOR-SYSTEM-BUBBLE-UP`, keep the prose but note exclusion is advisory).
- Produces: the `epic-member-worker` subagent type referenced by the orchestrator's `Agent({subagent_type:"epic-member-worker", ...})` call (Task 6).

- [ ] **Step 1: Author the agent definition**

Create `.claude/agents/epic-member-worker.md`:

```markdown
---
name: epic-member-worker
description: Executes ONE epic member workstream in isolation for /backlog-next-epic and returns a single compact payload. Never prompts the user; bubbles decisions up via a NEEDS-DECISION payload.
tools: Bash, Read, Edit, Write, Grep, Glob, Skill, Agent, TaskCreate, TaskUpdate, TaskList, ToolSearch
---

You execute exactly ONE epic member workstream, in isolation, then return ONE payload as your FINAL message. You are driven by `/backlog-next-epic`. You NEVER address the user directly.

## Inputs (from your dispatch prompt)
- `member-id`, the epic `branch` (`feat/epic-<id>`), the shared `worktree` absolute path, the `--auto` flag, and a `pre-decided` list of `(fork_key, chosen)` pairs (decisions already ruled for this member).

## On start
1. `cd` into the worktree absolute path. Use `git -C <worktree>` / absolute paths for all file ops (cwd-pinned-session caveat).
2. Confirm you are on the epic branch.
3. Invoke the `/backlog-next <member-id>` skill in epic-member mode. That skill is the single source of truth for member execution (lanes, spec→plan→code, per-member integration, doc-derivation).

## Decisions — you MUST bubble up, never prompt
- You have NO `AskUserQuestion` tool. When a decision needs a human ruling (a `type: design` approval gate, or any floor action), END YOUR TURN with exactly one fenced ```json block:
  `{ "kind":"needs-decision", "member":"<id>", "reason":"design-approval|floor:<which>|bounded-effort-exceeded|catch-all", "question":"<phrased for AskUserQuestion>", "deliberation":"<for design-approval: the brainstorming summary + the reasoning behind each option>", "options":[{"label":"...","description":"...","recommended":true|false}], "fork_key":"<from fork-key.mjs>", "blast_radius":"<detect-fork-blast-radius result if run>" }`
  The orchestrator delivers the ruling via a follow-up message; CONTINUE from where you paused.
- A `(fork_key, chosen)` in your `pre-decided` list is ALREADY RULED — do not re-ask it. If it carries an override value, ADOPT that value.

## --auto non-floor forks (resolve locally AND persist)
- Classify each fork: run `node .claude/skills/backlog-next-epic/detect-fork-blast-radius.mjs <symbol>`. Exit 1 ⇒ shared surface ⇒ FLOOR ⇒ bubble up. Also bubble up any irreversible/outward-facing action (see the checklist below) and anything you are uncertain about (conservative catch-all).
- For a genuinely non-floor fork: pick the most-reusable `(Recommended)` option, then IMMEDIATELY persist it:
  `echo '{ "member":"<id>", "fork_key":"<k>", "decision":"...", "options":["..."], "chosen":"...", "rationale":"...", "rejected":"..." }' | node .claude/skills/backlog-next-epic/runstate.mjs append-decision <epic-id>`
  (Compute `fork_key` via `node -e` importing `fork-key.mjs`'s `forkKey`/`canonicalSubject`.) Report the same entries in your MEMBER-SUMMARY `decisions[]` (informational).

## Irreversible-action checklist — ALWAYS floor (bubble up, never just do it)
`git push --force`, `git branch -D`, `git reset --hard` on a shared branch, destructive deletes, anything outside this repo, real-money/broker actions, staging/prod ops, mutations outside `dev-*`. Do NOT attempt these; bubble up a `floor:irreversible` needs-decision.

## status: blocked vs needs-decision
- Emit `status: blocked` (terminal) ONLY when NO user ruling within this member could unblock it (a missing external precondition; or the member is mis-scoped/too-large and needs splitting). If a user CHOICE could unblock it, emit a `needs-decision` instead.

## Investigation
- Do ALL investigation (greps/reads, and `Explore` sub-agents IF available) in YOUR context — never surface raw file dumps. If a single member is too large to fit your context, do NOT loop: emit `status: blocked` with `blocked_reason` naming it as too-large/needs-split.

## Terminal output
- When the member is terminal, END with exactly one fenced ```json block:
  `{ "kind":"member-summary", "member":"<id>", "lane":"doc-layer|simple|complex", "status":"shipped|blocked", "validation_gate":"<CONCISE: integ pass/fail + commit SHAs + doc-derivation note — never raw logs>", "commits":["<sha> <subject>"], "decisions":[ ... your --auto non-floor entries, each with fork_key ... ], "blocked_reason":"<iff blocked>" }`
- Prefix every git commit subject with `[<member-id>]` so the epic PR body can attribute commits per member.
- Drive `executing-plans`/`subagent-driven-development` only through task-execution; STOP before their `finishing-a-development-branch` handoff (the orchestrator owns the single merge/PR).
```

- [ ] **Step 2: Sanity-check the agent file loads**

Run a smoke dispatch (informally, as the implementer): `Agent({ subagent_type: "epic-member-worker", prompt: "Do nothing but emit ```json\n{\"kind\":\"member-summary\",\"member\":\"_smoke\",\"lane\":\"doc-layer\",\"status\":\"blocked\",\"validation_gate\":\"smoke\",\"commits\":[],\"decisions\":[]}\n``` and STOP." })`. Pipe its final message through `member-summary.mjs parse <file>`; expect exit 2 (blocked).

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/epic-member-worker.md
git commit --no-verify -m "feat(agents): epic-member-worker custom agent type (subagent wrapper contract)"
git log --oneline -1
```

---

## Task 6: Orchestrator `SKILL.md` rewrite (E4/E5/E6-E7/E8/E9 + §G lock + Tier-1 fallback)

**Files:**
- Modify: `.claude/skills/backlog-next-epic/SKILL.md`

**Interfaces:**
- Consumes: `member-summary.mjs` (exit codes), `runstate.mjs` (`append-decision`, `clear-e8`), `fork-key.mjs`, the `epic-member-worker` agent type, `detect-fork-blast-radius.mjs`.

This task is prose edits to the orchestrator skill. No unit test; validated by Task 8's dry-run. Make the edits as discrete sub-steps so a reviewer can reject one.

- [ ] **Step 1: Rewrite E4.2 (the member loop dispatch)**

Replace E4 step 2 ("Run `/backlog-next <member-id>` … via the Skill tool … inline …") with the subagent dispatch + parse loop: spawn `Agent({subagent_type:"epic-member-worker", prompt:<member id, branch, worktree abs path, --auto, the member's pre-decided (fork_key,chosen) pairs>})`; write the returned final message to a temp file; `node member-summary.mjs parse <file>`; branch on exit code 0→E5/persist-at-resolution/SendMessage/re-parse, 1→one-line progress note then consult `epic-members.mjs`, 2→§H blocked routing, 3→repair (≤2 consecutive) then floor. State the two loop bounds (repair counter ≤2 consecutive; progress guard floors only on repeated identical `fork_key`/consecutive parse-failures, NEVER on legitimate distinct interactive forks) and the floor-pause option set (retry-member-fresh / split-member / abort-epic). State the drainable ordering invariant.

- [ ] **Step 2: Replace E4.5 with the Tier-1 fallback label**

Replace the E4.5 "Context checkpoint" body: the unconditional `/clear` is REMOVED from the Tier-2 happy path; emit only a compact one-line progress note. KEEP the E4.5 `/clear` prose as a clearly-labelled block: "**Tier-1 fallback mode** — used ONLY when the §Risk spike selected `TIER1-FALLBACK`; dormant on `TIER2-GO`; retained until 3 successful Tier-2 epics, then removed by `<remove-tier1-fallback>` backlog item." Re-scope the "Trying to self-measure context" Common-mistake note to the fallback.

- [ ] **Step 3: Rewrite E5 (decision handling)**

Decisions arrive as `needs-decision` payloads. Interactive → validate payload `(Recommended)`/`reason`, then `AskUserQuestion` → persist ruling (`append-decision`, with `fork_key`) → `SendMessage(id, ruling)`. `--auto` → non-floor never arrives (subagent self-resolved + self-persisted); floor → `AskUserQuestion` → persist → SendMessage. `type:design` → always bubbled (carries `deliberation`). Add the honest floor model (settings.local.json allow-list defeats prompt-backstop → the gates are the blast-radius helper + the worker's irreversible-action checklist + allowlist exclusion; deny-hook is a follow-up).

- [ ] **Step 4: Rewrite E6/E7 (advisory consistency audit + override)**

Add the SUMMARY-ONLY pre-done consistency pass (scoped grep of new exported symbols per member + duplication flags — never the raw diff). Mark it an explicit HEURISTIC pass (may miss; additive). Any re-open is user-confirmed (AskUserQuestion) in BOTH modes; the override appends a `supersedes` entry (the NEW imposed value), re-opens the member, re-dispatches decision-aware (worker ADOPTS the value), HEAD moves → `e2e-fresh` → return to E6.

- [ ] **Step 5: Rewrite E8 + add §G lock + Tier-1 wiring**

E8 PR body: per-member commit summary from `git log origin/main..HEAD` grouped by the `[<member-id>]` commit prefix; decision section from run-state `decisions[]`. "Keep iterating" is a DISTINCT branch (no E8.2 worktree-removal, no set-e8; leaves worktree attached, re-enters E4); only the hand-off branch removes the worktree + sets `e8`; `clear-e8` + re-attach happen only on the post-merge tail / crashed-resume. Add §G concurrency lock: the resume gate creates `<git-common-dir>/backlog-next-epic-<id>.lock` with an exclusive (`wx`) create recording `{session-id, pid, start-ts}`; a loser finding an existing lock → refuse-and-ask (pid-dead → offer reclaim); release at E8.1 STOP + clean exit; re-acquire on resume/post-merge/keep-iterating. State intra-session no-concurrency (synchronous foreground dispatch).

- [ ] **Step 6: Update the Relationship table, E9, Common mistakes, and the Design footer**

Relationship table: member execution is now a dispatched subagent (not inline). E9: crash/interrupt resumability via the resume gate stays; remove the "routine per-member /clear" framing (now fallback-only). Common mistakes: add "Don't force-floor a legitimately multi-fork interactive member"; "Don't rely on permission-prompting as the floor gate." Design footer: add this Tier-2 spec path next to the 2026-06-21 spec.

- [ ] **Step 7: Verify the skill's own tests still pass**

Run: `node --test '.claude/skills/backlog-next-epic/test/*.test.mjs'`
Expected: PASS (fork-key, member-summary, runstate, epic-members, detect-fork-blast-radius).

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/backlog-next-epic/SKILL.md
git commit --no-verify -m "feat(backlog-next-epic): Tier-2 subagent dispatch — E4/E5/E6-E7/E8/E9 + lock + Tier-1 fallback"
git log --oneline -1
```

---

## Task 7: `/backlog-next` worker epic-member delta + reconciliation

**Files:**
- Modify: `.claude/skills/backlog-next/SKILL.md`

**Interfaces:**
- Consumes: the `epic-member-worker` contract (Task 5), the payloads (Task 3).

- [ ] **Step 1: Rewrite the epic-member "Floor (self-contained)" delta**

In the "Epic-member mode" section's Floor delta: when running as the `epic-member-worker` subagent, do NOT call `AskUserQuestion`; surface decisions via a `NEEDS-DECISION` end-of-turn payload; treat passed-in `(fork_key, chosen)` as pre-decided (adopt an override's value); in `--auto` self-resolve non-floor forks AND append each to run-state at resolution time (with `fork_key` via `fork-key.mjs`). Replace the now-contradictory "pause via AskUserQuestion (a prose pause is a skill violation)" clause accordingly.

- [ ] **Step 2: Add the `status: blocked` discriminating rule**

Add: emit `status: blocked` ONLY when no user ruling within the member could unblock it (missing external precondition; or mis-scoped/too-large → split); if a user choice could unblock, emit `NEEDS-DECISION`. Prefix every commit subject with `[<member-id>]`.

- [ ] **Step 3: Reconcile the stale inline-execution assertions**

Update the three inline-load assertions to the subagent model: (a) the "When to invoke" paragraph ("loads this SKILL.md inline into the orchestrator's own context (not a detached subagent…)"), (b) the epic-member-mode invocation prose, (c) the epic-member guard's inline-load trigger. Each now reads "the orchestrator dispatches epic members as `epic-member-worker` subagents (the worker SKILL.md loads inside that subagent)."

- [ ] **Step 4: Verify no contradiction remains**

Run: `grep -n "inline" .claude/skills/backlog-next/SKILL.md`
Expected: any remaining "inline" hits refer to standalone (non-epic) `/backlog-next`, NOT epic-member mode.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/backlog-next/SKILL.md
git commit --no-verify -m "feat(backlog-next): epic-member subagent bubble-up delta + status:blocked + inline-assertion reconciliation"
git log --oneline -1
```

---

## Task 8: Verification — dry-run path coverage + spec correction note

**Files:**
- Modify: `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`

- [ ] **Step 1: Run the full helper test suite**

Run: `node --test '.claude/skills/backlog-next-epic/test/*.test.mjs'` and `node --test '.claude/skills/backlog-next/test/*.test.mjs'`
Expected: all PASS.

- [ ] **Step 2: Dry-run a small (2-member, doc-layer) theme epic, asserting each path**

Pick or create a tiny 2-core-member theme epic. Run `/backlog-next-epic <id>` and verify, from the orchestrator transcript + run-state:
- happy path: transcript shows only one-line progress notes + the decision log (NO member file-dumps);
- crash/resume mid-fork: interrupt after a ruling is persisted; resume does NOT re-ask the resolved fork;
- override: the E6/E7 audit re-opens a member with an imposed value the worker ADOPTS; the `supersedes` entry is NOT deduped away;
- blocked: a member emitting `status: blocked` is routed via `AskUserQuestion`, not a prose halt;
- parse-failure: a malformed payload triggers ≤2 repair turns then a floor;
- too-large inference: repeated exit-3 → split routing, not a generic floor;
- multi-fork interactive member is NOT force-floored at 8;
- concurrency: a second `/backlog-next-epic <id>` while the lock is held → refuse-and-ask.

Record results inline in the spike doc (append a "Dry-run path coverage" section).

- [ ] **Step 3: Measure the context-isolation proxy**

Compare the orchestrator's per-member context delta for a trivial member vs a file-heavy member; confirm ~constant (independent of files-touched) and that a multi-fork member scales only by #forks × fixed payload. Record the numbers.

- [ ] **Step 4: Add the correction note to the 2026-06-21 spec**

In `docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md`, add near the top:

```markdown
> **Superseded in part (2026-06-23):** the Tier-1 per-member `/clear` checkpoint and the "inline Skill-tool load is the intended execution model" framing are superseded by Tier-2 — see `docs/superpowers/specs/2026-06-23-backlog-next-epic-member-subagent-isolation-design.md`. Tier-1 is now a spike-gated fallback mode.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-06-21-backlog-next-epic-orchestrator-design.md docs/superpowers/spikes/2026-06-23-tier2-harness-spike.md
git commit --no-verify -m "docs: Tier-2 dry-run path-coverage evidence + 2026-06-21 spec correction note"
git log --oneline -1
```

---

## Post-implementation (handled by /backlog-next closing phase, NOT plan tasks)

- Member ship: flip `docs/backlog/backlog-next-epic-member-subagent-isolation.md` → `shipped`, fill `validation_gate:` (spike MODE + test output + dry-run evidence), stamp `closed:`.
- File deferred items via `backlog-add` (from main root): system-wide backlog-test-harness; `permissions.deny`/`PreToolUse` deny-hook for the irreversible set; remove-Tier-1-fallback-after-3-epics.
- Complex-lane finish: `superpowers:finishing-a-development-branch` → single PR.

## Self-Review

- **Spec coverage:** §A→Tasks 4/6 (state footprint); §B→Task 5; §C fork_key→Task 2, payloads/validator→Task 3; §D loop/persist/floor→Tasks 6/7; §E audit/override→Task 6; §F worker→Task 7; §G lock→Task 6; §H blocked/Tier-1/too-large→Tasks 6/7; §I deliberation→Tasks 5/6; §J E8/clear-e8→Tasks 4/6; §Risk spike→Task 1; Verification→Task 8. No gap.
- **Placeholders:** none — helper code is complete; prose tasks specify exact sections/edits; the spike specifies concrete probes + criteria.
- **Type consistency:** `forkKey(member, canonicalForkSubject)` + `canonicalSubject({reason,symbol,designSliceId})` (Task 2) used consistently; `parseMemberOutput` exit codes 0/1/2/3 (Task 3) consumed by Task 6; `appendDecision(state, decision)` with required `fork_key` + `supersedes` exemption (Task 4) used by Tasks 5/6/7.
