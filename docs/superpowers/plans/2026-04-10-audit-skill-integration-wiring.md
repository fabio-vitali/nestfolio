# Audit Skill Integration Test Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `audit-integration-test` into the audit cascade so `audit-service` invokes it as a per-service sub-check with suffix-based gating, and fix the false "Called by" claim in `audit-integration-test`.

**Architecture:** Two markdown file edits. `audit-service/SKILL.md` gets a retitle of check #4 (to scope it to unit tests), a new check #9 (delegating to `audit-integration-test`), and a new paragraph explaining the suffix-gated sub-check logic. `audit-integration-test/SKILL.md` gets its "When This Skill Applies" bullet rewritten to match reality. `audit-domain`, `audit-system`, and all other skills are untouched — they inherit the cascade via `audit-service`.

**Tech Stack:** Markdown only. No code, no tests, no build. Verification is grep-based.

**Spec:** `docs/superpowers/specs/2026-04-10-audit-skill-integration-wiring-design.md`

---

## Context for the implementer

This is a documentation-only change to two skill definition files. Skills are markdown files under `.claude/skills/<skill-name>/SKILL.md` that the Claude Code runtime loads and interprets. They are not code, not config — they are human-and-model-readable instructions.

**The false claim you're fixing:**

`audit-integration-test/SKILL.md` currently says it is "Called by `audit-service` or `audit-domain` as sub-check" — but neither skill actually invokes it. The fix has two parts:

1. Make `audit-service` actually invoke `audit-integration-test` (Task 1).
2. Rewrite the claim in `audit-integration-test` to accurately describe the new reality (Task 2).

**Why suffix gating matters:**

The project has 33 services. 28 have `test/integration/` directories today (all `-ctrl`, `-bff`, `-adpt`). 5 don't: 4 `-hub` services (EventBridge routers with no business logic, the integration test model doesn't apply) and 1 `-web` service (Angular frontend, different test model). Hard-failing on missing `test/integration/` for hubs and web services would be wrong. The new check #9 must gate its behavior on service suffix:

- `-ctrl`, `-bff`, `-adpt` → hard fail if `test/integration/` missing, else invoke `audit-integration-test`
- `-hub` → report `N/A` with reason
- `-web` → report `N/A` with reason

**Things that must stay invariant:**
- `audit-domain/SKILL.md` and `audit-system/SKILL.md` are not touched. The cascade handles propagation.
- The "Batch Audit (Multiple Services)" section in `audit-integration-test` stays as-is (it remains valid for standalone manual invocation).
- Nothing outside `.claude/skills/audit-service/SKILL.md` and `.claude/skills/audit-integration-test/SKILL.md` changes.

**No tests:** these are markdown files loaded by the Claude Code runtime; they have no unit tests. Verification is by grep and manual reading.

---

## File Structure

**Modify:**
- `.claude/skills/audit-service/SKILL.md` — three edits inside the `### Verification Checks` section (lines 95–106 in current HEAD)
- `.claude/skills/audit-integration-test/SKILL.md` — one edit inside `## When This Skill Applies` (line 10 in current HEAD)

**Do not touch:**
- `.claude/skills/audit-domain/SKILL.md`
- `.claude/skills/audit-system/SKILL.md`
- `.claude/skills/create-service/SKILL.md`
- `.claude/skills/create-feature/SKILL.md`
- `.claude/skills/testing-patterns/SKILL.md`
- `.claude/skills/ci-audit/SKILL.md`
- `CLAUDE.md` skill routing table
- Any service's `CLAUDE.md` card

---

## Task 1: Wire `audit-integration-test` into `audit-service` as check #9

**Files:**
- Modify: `.claude/skills/audit-service/SKILL.md:102` (retitle check #4)
- Modify: `.claude/skills/audit-service/SKILL.md:106` (append new check #9 row)
- Modify: `.claude/skills/audit-service/SKILL.md:107` (append sub-check paragraph after the table)

### Step 1: Retitle check #4 to scope it to unit tests

Open `.claude/skills/audit-service/SKILL.md`. Find line 102, which currently reads:

```
| 4 | Test coverage: every handler has corresponding test | Warning | Compare handler vs test file lists |
```

Replace it with:

```
| 4 | Unit test coverage: every handler has corresponding test in test/ (excluding test/integration/) | Warning | Compare handler vs test file lists |
```

The only change is the wording inside the check name — the severity (Warning) and the "How to Check" column are unchanged.

- [ ] **Step 1 complete:** check #4 retitled.

### Step 2: Add new check #9 to the Verification Checks table

Find line 106, which currently reads:

```
| 8 | Event emission completeness: all emission paths documented in card | Warning | Check CDC Egress, errorEventType, grantPutEventsTo, noneDataSource resolvers, SF PutEvents integrations |
```

Append a new row immediately after it (so it becomes the new line 107):

```
| 9 | Integration test coverage: test/integration/ exists and passes audit-integration-test (gated on service suffix) | Hard fail | Invoke audit-integration-test skill as sub-check; hard fail if directory absent AND suffix is -ctrl, -bff, or -adpt |
```

Do not renumber the existing rows. The table now has 9 rows (1–9).

- [ ] **Step 2 complete:** check #9 row added.

### Step 3: Add the integration test sub-check paragraph

Immediately after the Verification Checks table (after the new check #9 row) and BEFORE the `### Self-Healing` heading (currently line 108), insert a new blank line followed by this paragraph:

```markdown
**Integration test sub-check (check #9)**: Determine applicability by service suffix, then act:

- **`-ctrl`, `-bff`, `-adpt`** (backend business services): if `test/integration/` exists, invoke the `audit-integration-test` skill and incorporate its findings into the audit report. If the directory is absent, hard-fail with the message: `"Service has no test/integration/ directory — integration tests are required for -ctrl/-bff/-adpt services (baseline: 28/28 covered today). Add tests via create-integration-test skill."`
- **`-hub`** (event bus routers): skip check #9 entirely. Hubs are pass-through EventBridge routers with no business logic; the integration test model does not apply. Report as `"N/A — hub services route events, no integration test required."`
- **`-web`** (Angular frontends / MFEs): skip check #9 entirely. Web apps use a different test model (Angular component tests, E2E via Playwright/Cypress) and do not consume the `@nestfolio/integration-testing` lib. Report as `"N/A — web services use a different test model."`

```

Make sure there is a blank line between the table, the paragraph, and the `### Self-Healing` heading. Markdown rendering depends on the blank lines.

- [ ] **Step 3 complete:** sub-check paragraph inserted.

### Step 4: Verify the file still reads correctly

Run:

```bash
grep -n '^| [0-9]\+ |' .claude/skills/audit-service/SKILL.md
```

Expected output — nine rows numbered 1 through 9, with the retitled #4 and the new #9:

```
99:| 1 | File structure: `src/`, `test/`, `src/service.stack.ts`, `project.json` | Hard fail | `ls` the paths |
100:| 2 | Naming: suffix is `-ctrl`, `-bff`, `-hub`, `-adpt`, or `-web` | Hard fail | Parse directory name |
101:| 3 | Handler pattern: every Lambda uses event-processor pipeline | Hard fail | Grep handlers for pipeline imports |
102:| 4 | Unit test coverage: every handler has corresponding test in test/ (excluding test/integration/) | Warning | Compare handler vs test file lists |
103:| 5 | CDK pattern: extends ServiceStack | Warning | Read service.stack.ts imports |
104:| 6 | Card freshness: CLAUDE.md matches code | Auto-fix | Regenerate and compare |
105:| 7 | Import boundaries: no imports from `services/` | Hard fail | `grep -r "from.*services/" src/` |
106:| 8 | Event emission completeness: all emission paths documented in card | Warning | Check CDC Egress, errorEventType, grantPutEventsTo, noneDataSource resolvers, SF PutEvents integrations |
107:| 9 | Integration test coverage: test/integration/ exists and passes audit-integration-test (gated on service suffix) | Hard fail | Invoke audit-integration-test skill as sub-check; hard fail if directory absent AND suffix is -ctrl, -bff, or -adpt |
```

Line numbers may shift slightly depending on your exact insertion, but the content of each row must match. Also run:

```bash
grep -c 'audit-integration-test' .claude/skills/audit-service/SKILL.md
```

Expected: `2` (one in check #9 row, one in the sub-check paragraph).

- [ ] **Step 4 complete:** grep confirms the table has nine rows and `audit-integration-test` is referenced twice.

### Step 5: Commit

```bash
git add .claude/skills/audit-service/SKILL.md
git commit -m "$(cat <<'EOF'
docs(skills): wire audit-integration-test into audit-service

Retitle check #4 to scope it explicitly to unit tests. Add new check
#9 delegating to audit-integration-test, gated on service suffix:
hard fail for -ctrl/-bff/-adpt missing test/integration/, N/A for
-hub and -web suffixes. Cascade propagates via audit-domain and
audit-system automatically.
EOF
)"
```

- [ ] **Step 5 complete:** commit landed.

---

## Task 2: Fix the false "Called by" claim in `audit-integration-test`

**Files:**
- Modify: `.claude/skills/audit-integration-test/SKILL.md:10`

### Step 1: Replace the false bullet

Open `.claude/skills/audit-integration-test/SKILL.md`. Find line 10, which currently reads:

```
- Called by `audit-service` or `audit-domain` as sub-check
```

Replace it with two bullets:

```
- Called by `audit-service` as a per-service sub-check (hard-fails if `test/integration/` absent for -ctrl/-bff/-adpt services)
- Cascades transitively through `audit-domain` and `audit-system` via `audit-service`
```

Do not touch the other bullets in the "When This Skill Applies" section. Do not touch any other part of the file — specifically, the "Batch Audit (Multiple Services)" section stays as-is.

- [ ] **Step 1 complete:** bullet replaced.

### Step 2: Verify the old string is gone

Run:

```bash
grep -rn "Called by \`audit-service\` or \`audit-domain\` as sub-check" .claude/skills/
```

Expected output: **nothing** (zero matches).

If anything is returned, you haven't removed the old bullet — go back and fix it.

- [ ] **Step 2 complete:** old string is gone from all skills.

### Step 3: Verify the new bullets are present

Run:

```bash
grep -n 'Called by' .claude/skills/audit-integration-test/SKILL.md
grep -n 'Cascades transitively' .claude/skills/audit-integration-test/SKILL.md
```

Expected: one match each, both inside the "When This Skill Applies" section (around line 10–11).

- [ ] **Step 3 complete:** both new bullets are present.

### Step 4: Commit

```bash
git add .claude/skills/audit-integration-test/SKILL.md
git commit -m "$(cat <<'EOF'
docs(skills): fix false 'Called by' claim in audit-integration-test

The skill previously claimed to be called by both audit-service and
audit-domain as a sub-check, but neither skill actually invoked it.
Now that audit-service check #9 delegates to this skill, the claim
is true. Rewrite the bullet to accurately describe the single
invocation point and the transitive cascade via audit-service.
EOF
)"
```

- [ ] **Step 4 complete:** commit landed.

---

## Task 3: End-to-end verification

**Files:** none (verification task — all edits are complete).

This task confirms the spec's verification plan. It's best run by invoking the skills from a Claude Code session against the real repo.

- [ ] **Step 1:** Run `audit-service` on a `-ctrl`/`-bff`/`-adpt` service with an existing `test/integration/` directory (e.g., `services/advisory/sec-edgar-adpt`). Expect the audit report to include `audit-integration-test` sub-check output.

- [ ] **Step 2:** Run `audit-service` on a `-hub` service (e.g., `services/advisory/advisory-hub`). Expect check #9 to report `"N/A — hub services route events, no integration test required."` and NOT hard-fail despite the absence of `test/integration/`.

- [ ] **Step 3:** Run `audit-service` on `services/investor/investor-web`. Expect check #9 to report `"N/A — web services use a different test model."` and NOT hard-fail.

- [ ] **Step 4:** Temporarily rename a `-ctrl` service's `test/integration/` directory (e.g., `mv services/advisory/sec-edgar-adpt/test/integration services/advisory/sec-edgar-adpt/test/integration.bak`), run `audit-service` on that service. Expect hard fail with the stated message. Then rename back (`mv services/advisory/sec-edgar-adpt/test/integration.bak services/advisory/sec-edgar-adpt/test/integration`).

- [ ] **Step 5:** Run `audit-domain advisory`. Expect 14 `-ctrl`/`-bff`/`-adpt` services to get full sub-checks and the 1 `-hub` service (`advisory-hub`) to get `N/A`. Domain-level checks (adapter subs, event contracts, flow validation) are unchanged.

- [ ] **Step 6:** Run `audit-system`. Confirm the cascade holds: 28 services get full integration test checks, 5 get `N/A` (4 hubs + 1 web). Zero hard fails against current HEAD state.

- [ ] **Step 7:** Run this grep to confirm the old false claim is gone from all skills:

```bash
grep -rn "Called by \`audit-service\` or \`audit-domain\` as sub-check" .claude/skills/
```

Expected: zero matches.

- [ ] **Step 8:** Run this grep to confirm `audit-service` references `audit-integration-test`:

```bash
grep -c "audit-integration-test" .claude/skills/audit-service/SKILL.md
```

Expected: `2` (check #9 row + sub-check paragraph).

---

## Rollback plan

If the cascade behaves unexpectedly (e.g., false hard fails during a legitimate audit, or infinite recursion):

1. Revert the commit from Task 1 (audit-service edits). This removes check #9 and the sub-check paragraph; `audit-service` returns to its previous behavior. The cascade stops invoking `audit-integration-test`.
2. The Task 2 commit is safe to keep or revert independently — it's a pure documentation fix. If kept, the bullet now claims `audit-service` calls it (which would be untrue again post-revert); revert it too for consistency.
3. Investigate root cause and re-apply fixes.

Neither file change has runtime side effects, so rollback is trivial (`git revert`).

---

## Summary of commits

1. `docs(skills): wire audit-integration-test into audit-service`
2. `docs(skills): fix false 'Called by' claim in audit-integration-test`

Two small commits, same PR. No code, no tests, no build — pure markdown.
