# `/backlog-next-epic` severity-aware selection — Design

- **Date:** 2026-06-24
- **Status:** Draft (brainstormed; awaiting spec review → writing-plans)
- **Workstream:** `docs/backlog/backlog-next-epic-severity-selection.md`
- **Related:** `.claude/skills/backlog-next-epic/SKILL.md`, `.claude/skills/backlog-next-epic/epic-members.mjs`, `.claude/skills/backlog-lint/lib/`

## 1. Problem

Today `/backlog-next-epic` selects an epic by a fixed lifecycle order: resume the `active`
epic, else list candidates (`queued` by `rank`, then `parking` theme epics) and ask. There is
no way to say "work the **most impactful** epic next," or to pick by a free-text intent like
*"fix worst bug"* / *"most urgent refactoring"* — the original request that started this design.

## 2. The decisive investigation (why NOT a stored `severity` field)

The intuitive fix — add a `severity:` frontmatter field, auto-write it, sort by it — was
**rejected** after investigating the codebase. Two findings killed it:

1. **Drift is structural, not incidental.** The backlog system has a hard architectural rule:
   *store the minimal pointer structure; compute everything else deterministically.* `BACKLOG.md`,
   `related_workstreams`, epic membership, rollup counts, all orderings are **derived** and
   regenerated on every `lint --fix` *specifically to prevent drift*. The only things it **stores**
   are authoritative *decisions* that cannot be computed (`status`, `rank`, `type`, `epic` pointers,
   `done_when`, `scope`). A `severity` is neither: it is an **assessment of the codebase's current
   reality** ("how bad is this") that goes stale as code changes and that **no routine re-derives**.
   That is the one category the system architecturally avoids — stored, drift-prone, and not a pure
   decision.
2. **Complexity cost on already-baroque machinery.** The suite is ~3,900 lines, 11 lint invariants,
   a closed-schema run-state, and **19 hard-won "F-number" bug fixes**. A persisted field touching
   5–6 skills was assessed "High" marginal cost — and *"not obviously reusable unless severity gates
   a decision"* (ours would be selection/display only), which fails the project's reusability test.

**Decision:** compute the impact ordering **at selection time** over the ~10–15 candidate epics,
surface it ranked-with-reasons via `AskUserQuestion`, and persist **nothing**. Both worries (drift
and complexity) are consequences of *persistence*; dropping persistence dissolves both. This is also
consistent with the system's own derive-don't-store invariant — its most reusable principle.

The earlier "don't vibe-select" caution does not apply here: that was about replacing the persistent
`rank` of 100+ items with model judgment and no human gate. At ~10 candidate epics, always
human-confirmed, with the run-state decision-log already recording the choice, none of those
downsides remain.

## 3. Goal

Let `/backlog-next-epic` rank its **existing** candidate list by impact (default) or by a free-text
criterion, surface the top few **with the model's reasons** for the user to confirm, then proceed
into the normal promote → worktree → member-loop flow. No new persistent state.

## 4. Design

### 4.1 Form surface (three forms)

| Invocation | Behaviour |
|---|---|
| `/backlog-next-epic` | **Default — severity-ranked menu.** Resume an `active` epic if one exists (lifecycle precedence, unchanged). Otherwise build the candidate list and order it by impact scored at read time against the rubric (§5); surface top-N with reasons via `AskUserQuestion`; user confirms. |
| `/backlog-next-epic --like "<criteria>"` | **Semantic-ranked menu.** Same flow, but rank candidates by the free-text criterion (for fuzzy/thematic intents the rubric can't express, e.g. *"anything touching the broker circuit breaker"*). |
| `/backlog-next-epic <epic-id>` | **Direct.** Unchanged — run that epic. Disambiguation: an arg that resolves to an existing `type: epic` id is the epic id; otherwise it is treated as a `--like` criterion (so the bare `/backlog-next-epic fix worst bug` works). |

`--auto` composes with all three.

### 4.2 `rank` stays authoritative

The severity ordering **must not silently override a human priority decision**:

- An `active` epic still **resumes** — no menu.
- `queued` epics keep their human-set `rank`; severity orders only the **`parking` theme epics**
  (the otherwise-unordered bulk — the backlog currently has ~28 theme epics, ~0 queued). Computed
  impact is shown as *context* on every candidate, never as a `rank` override.

Severity is therefore a pure **read-time ordering/presentation** concept; it is persisted nowhere.

### 4.3 Components

1. **`--candidates` gather (helper).** Extend `epic-members.mjs` (or a sibling helper) with a
   `--candidates` mode that deterministically emits the candidate set — the `active` epic (if any),
   `queued` epics (with `rank`), and `parking` theme epics — each annotated with `notes`, `scope`,
   `done_when`, and **open-core-member count** (via the existing `coreMembers`/`openMembers` logic).
   This is the *gather* (deterministic, unit-tested). The *ranking* is performed by the model reading
   this output against the rubric/criterion — model judgment, not unit-tested.
2. **`severity-rubric.md`** under `.claude/skills/backlog-lint/lib/` — the shared, consistent
   definition of impact levels (§5). Consulted at selection time so "worst" means something stable
   across runs. **Stored nowhere in frontmatter; never written back.**
3. **`/backlog-next-epic` SKILL.md edits.** Arg parsing (id vs `--like` vs bare-criterion vs
   default); the rank → `AskUserQuestion`-confirm step slotted into the existing "list candidates and
   ask" path; the rubric reference.
4. **E5 floor update.** A criteria-/default-selected pick **must be human-confirmed via
   `AskUserQuestion` even under `--auto`** — never auto-launch the top-ranked epic onto a whole
   branch/deploy/e2e budget. This extends the existing E5 floor (which already pauses on balanced
   forks and irreversible actions). `<epic-id>` (an explicit pick) is unaffected.

### 4.4 Data flow

```
/backlog-next-epic [arg] [--auto]
  └─ resume gate: active epic? ──yes──▶ resume it (unchanged)
        │ no
        ▼
  epic-members.mjs --candidates  ─▶  candidate set + per-epic {notes, scope, done_when, open-core}
        │
        ▼
  rank: default → score each vs severity-rubric.md ;  --like → score vs criterion
        │   (queued keep rank; parking tail severity-ordered; impact shown as context)
        ▼
  AskUserQuestion(top-N, with reasons)  ◀── ALWAYS, incl. --auto (E5 floor)
        │  user confirms one
        ▼
  existing E1 promote → E2 worktree → E4 member loop … (unchanged)
```

## 5. The severity rubric (read-time scoring guide)

A small ordinal guide, used only to make "impact" consistent across runs. Indicative levels:

- **critical** — data loss / silent prod leak / real-money correctness / blocks all e2e.
- **high** — broken flow with no workaround / latent crash on a common path / blocks a domain's e2e.
- **medium** — degraded UX or correctness with a workaround / single-service latent bug.
- **low** — cosmetic / cleanup / docs drift / speculative hardening.

For an **epic**, impact = the **aggregate blast-radius of its theme** (the judgment `backlog-themes`
already makes when it prints a cluster's blast radius), informed by its open-core-member count and
`done_when`/`scope`. The rubric text is the single source of truth; the exact wording is finalized in
the implementation plan.

## 6. Error handling / edge cases

- **No candidates** (no active epic, no queued/parking epics) → report "no epics to run; promote or
  mint one via `/backlog-themes`," same as today's empty path.
- **Ambiguous arg** → resolve as epic-id when it matches a `type: epic` file, else criterion. A
  mis-parse is harmless: the user sees the ranked menu and picks, so a criterion misread as a
  (non-existent) id falls through to "not found → list close matches," and a valid id is honoured.
- **`--auto` with no/`--like` arg** → still pauses at the confirm `AskUserQuestion` (E5 floor). `--auto`
  never silently launches an epic chosen by a computed ordering.
- **`<epic-id>` + `--auto`** → unchanged: explicit pick, proceeds (subject to the existing rule-11 /
  resume guards).

## 7. Testing

- **Unit (`node --test`):** the `--candidates` gather (correct candidate set, counts, annotations)
  and the id-vs-criterion disambiguation. These are pure helper logic, in the established
  `epic-members.mjs` test style.
- **Not unit-tested (by nature):** the semantic/severity *ranking* itself is model judgment. Its
  safety net is the mandatory `AskUserQuestion` confirm — a wrong ordering only re-orders a menu the
  human still picks from.

## 8. Rejected alternatives

- **A — persisted `severity` field** (+ rubric + lint rule + index column + auto-write in
  backlog-add/themes + a `/backlog-recalibrate` sweep + selectors). Most capable (passive at-a-glance
  triage column, deterministic sort) but bakes in the stored-copy-that-drifts the system avoids, at
  "High" complexity across 5–6 skills. Rejected — see §2.
- **C — persisted + freshness/cache-invalidation** (stamp severity with a SHA/date, grey out stale
  values). Honestly confronts drift but by *adding* cache-invalidation machinery, worsening the
  complexity worry. Worst-of-both for this system. Rejected.

## 9. Out of scope

- Any **persisted** `severity`/`urgency` frontmatter field, and any lint/index/run-state-schema change.
- The `/backlog-recalibrate` sweep skill (only needed to fight drift of a stored field — moot here).
- The `/backlog-next` single-item mirror of `--like`/severity-ranking (the original examples were all
  epic-level; an easy follow-up if wanted later).
- Auto-launching an epic from a computed ordering without human confirmation (forbidden by the E5
  floor).
- Changing any existing backlog **behaviour** beyond candidate ordering + the new arg forms, or any of
  the 11 lint invariants.
- The separate `backlog-skills-simplification` epic (β lessons-extraction + γ procedure→helpers) —
  already filed; unrelated to this feature.
