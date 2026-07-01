# Runtime SPEC 2 — the backward edge & the learning loop (design)

**Date:** 2026-07-01
**Status:** design — approved-in-vision; **the moat**, proven FIRST on real lessons (VISION §15 sequencing)
**Workstream:** `runtime-realization` — SPEC 2 of the moat-first three-spec set (the backward edge)
**Inputs:** VISION `docs/vision/long-horizon-engineering-runtime.md` (§3 the thesis, §7 enforcement-as-memory, §9 the backward edge, §13.4 the human floor, §15.4 minting/retirement heuristics); TARGET-ARCH `docs/superpowers/specs/2026-06-30-long-horizon-runtime-target-architecture-design.md` (§9 the learning-loop closure, §8 the floor, §11 equivalence map); VISION REVIEW `docs/reviews/2026-07-01-long-horizon-runtime-vision-review.md` (the 5 surviving tensions — esp. **(a)** net-hardening-with-curation, **(c)** the checkable subset, **(e)** judgment-says-so); SPEC REVIEW `docs/reviews/2026-06-30-long-horizon-runtime-spec-review.md` ("the moat is the unbuilt backward edge").
**Consumes (verbatim):** SPEC 1 `docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md` — the frozen `CheckEntry` / `Provenance` / `Finding` / `Item` schemas, the `CheckStatus` enum, and `advanceLifecycle`. This spec does **not** re-shape them; it builds the two floor-gated procedures that *drive* them.
**Cross-references:** SPEC 3 `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md` — owns the eval-harness internals (this spec fixes only the §9 *landing handoff*), the `ask(decision)→choice` capability binding + the `<<HARNESS-PAUSE>>` sentinel, the watch engine's dangling-scope detector (this spec consumes its `staleness` finding), and the `journal` contract.
**Hard constraint:** the **backward-edge PROTOCOL is ring-1** — project- and harness-agnostic. Every Nestfolio-specific artifact (the `feedback_*` lessons, the `tools/check-*.mjs` gates they mint, the backlog frontmatter) appears **only** as a clearly-quarantined *first content-ring* example (§10, the dogfood plan). Where a design choice trades generality it states the reuse rationale.
**Locked decisions:** (1) **both arms are floor-gated** — mint *and* curate are the same kind of decision, the developer's (VISION §13.4); (2) **the backward edge is slow and rare by design** — most ships mint nothing; (3) **enforcement-as-memory is the checkable SUBSET**, never a totalizing replacement for retrieval (tension **(c)**); (4) **deterministic-first at mint time** — judgment is admissible only with a draft `flake_contract` + a candidate eval scenario (tension **(e)**); (5) **prove it on real lessons before generalizing** (VISION §15).

---

## 1. Problem

The forward machinery *runs today*: the watch engine's ancestors (34 scattered checks, SPEC 1 §1) detect, `backlog-add` files, `backlog-next` prioritizes and fixes, gates prove. What does **not** exist — anywhere, in this project or in the 2026 OSS field the SPEC REVIEW surveyed — is the **backward edge**: the move by which a shipped fix turns its lesson into a *permanent, enforced check*, and by which an obsolete guard is *retired at the same floor that minted it*.

**The concrete evidence of the gap:**

- **58 `feedback_*` lessons, zero of them executable.** Every lesson learned from a failure is prose in a dossier that the model must *remember to retrieve*. The grounding confirms **~17 of the 58 are mechanizable** (a pass/fail property) — and of those, only ~3-4 happen to have a check today, minted *by hand, with no provenance link back to the lesson*. There is no procedure that says "this fix taught a rule; here is the check it becomes."
- **No provenance, so no curation.** Not one of the 34 live checks records *which lesson or item minted it* (SPEC 1 §1). Without that link the reciprocal move is impossible: when a guarded property is deliberately changed, nothing knows which lesson to reconcile, and the guard rots green.
- **Enforcement is immortal by default.** `advisory-ctrl` was removed (33→32 services); `scanAll()` was deleted; the decision cycle was re-shaped twice. Each of those *deliberately changed a guarded property* — yet no mechanism surfaces the now-wrong guard, argues the retirement at a floor, and records the supersession. A pile of stale-but-green checks is itself the drift the Runtime exists to fight (VISION REVIEW A1).

**The one thing to build here:** the two floor-gated procedures — **mint** (post-ship) and **curate** (retire/supersede) — that drive SPEC 1's `advanceLifecycle`, plus the **enforcement-as-memory** binding (`mints:`) that keeps a lesson and its check in lockstep. This is the moat. Per the SPEC REVIEW ("the moat is the unbuilt backward edge") and VISION §15, this spec is **proven first on five real mechanizable lessons** (§10) before the forward loop widens or the seams generalize.

---

## 2. Decisions (locked in vision; restated as build premises)

Each names the failure it answers **and the reusable pattern it establishes** — pattern-reuse is the primary objective (CLAUDE.md Hard Constraints).

1. **Both arms are floor acts (VISION §13.4).** `candidate→active` (mint) and `active→superseded|retired` (curate) are the same kind of decision — the developer's — and both surface through `ask(decision)` (SPEC 3). *"Enforcement itself is a floor act."* Establishes the reusable **"a self-improving loop is safe iff every permanent change to its own enforcement passes a human floor"** pattern — the ratification gate the self-improving-agent literature (SPEC REVIEW) says is missing.

2. **The backward edge is slow, and the asymmetry is a feature (VISION §5, §9).** The forward loop turns every day; the backward edge is a periodic, considered enrichment that most ships skip. Establishes the **"fast reversible forward path, slow irreversible backward path"** pattern — minting stays rare, so each minted guard is worth carrying.

3. **Enforcement-as-memory is the checkable subset (tension (c), VISION §7).** Only the mechanizable fraction of a lesson (~17/58 here) becomes a check; the rest stays retrieval. The Runtime never claims enforcement *replaces* reminding. Establishes the **"executable memory is a second mode alongside recall, sized to what is checkable"** pattern.

4. **Deterministic-first at mint time (tension (e), VISION §13.3).** A drafted check is deterministic if the property is mechanizable; a judgment check is admissible only carrying a draft `flake_contract` + a candidate eval scenario, and is a standing *supersession candidate* for a later deterministic successor. Establishes the **"non-determinism is declared and scheduled for retirement, never hidden"** pattern.

5. **Curation is first-class, not an afterthought (tension (a), VISION §9).** Monotonic hardening means *net*-hardening-with-a-curation-cost: the two triggers (synchronous ship-gate + asynchronous dangling-scope) feed one floor decision (retire · supersede · keep), and the supersession chain + lesson `mints:` are reconciled in the same act. Establishes the **"mint and retire at one gate, with legible history"** pattern.

These were confirmed at the vision layer; this spec derives the procedures and data shapes and does **not** revisit them.

---

## 3. The two arms — and the asymmetry (load-bearing)

The backward edge has **two arms, both floor-gated**, because creating a permanent guard and removing one are the same kind of decision.

```
   item ships (post-checks pass, SPEC 1 gate context)
        │
        ├── MINT (post-ship, §4) ─────── optional, RARE ──────▶ ask(mint) ──▶ ratify · edit · decline
        │      draft a candidate check from the lesson                          │ on ratify (atomic, §4 step 4):
        │      (deterministic if mechanizable, else judgment)                    │   land eval scenario → register (active)
        │                                                                        │   → write lesson `mints:`
        │
        └── CURATE (§5) ── two triggers, one floor decision ──▶ ask(curate) ─▶ retire · supersede · keep
               (i)  SYNC  · ship-gate BLOCKING  — a deliberately-changed              │ on retire/supersede:
                    guarded property makes a guard fail; resolved BEFORE ship         │   status advances
               (ii) ASYNC · watch-engine NON-blocking — dangling-scope detector       │   + supersedes chain
                    files an obsolete guard as an ordinary `staleness` finding         │   + reconcile lesson `mints:`
```

**The asymmetry is the design, stated honestly (VISION §5, §9; requirement of tension (a)):**

| Property | Forward edge (SPEC 3) | Backward edge (this spec) |
|---|---|---|
| Cadence | continuous — turns every day | slow — periodic, floor-gated |
| Frequency | every item, every wake | **most ships mint nothing** |
| Reversibility | cheap, reversible | permanent enforcement → deliberate |
| Who decides | the loop (auto-eligible) | **always the human floor** (even in `--auto`, §6) |
| What compounds | throughput | **the moat — over months, not per-item** |

**Consequence (load-bearing):** the backward edge must be *engineered to be rare and considered*, not reflexive. §8 gives the heuristics that keep minting rare; §6 makes both arms hard-floor acts that pause even in auto mode. A backward edge that fired on every ship would be a new drift generator — the exact failure VISION §14 names ("a monotonic guarantee without a retirement path would just be a new kind of drift").

**Single-active is preserved (tension (d)).** Neither arm pivots the active item. **Mint** runs *after* the item's ship (its diff is already sealed inside its declared scope by the scope-gate check, SPEC 3). **Sync-curate** resolves *within* the same item's ship — the guard failed *because of this item's own sanctioned diff*, so fixing it is on-scope, not a pivot. **Async-curate** is filed as an *ordinary finding* by the watch engine and routed through intake to a *future* item — it never interrupts an unrelated ship. The backward edge adds no distraction surface.

---

## 4. Mint (post-ship) — the four steps + the candidate-check draft shape

Mint runs **after an item ships**, when the item resolved a finding or a failure and the lesson is worth permanent enforcement (§8 gates *whether* it fires). Four steps, mapping exactly to VISION §9:

**Step 1 — Post-checks pass.** Done is proven by the item's gates (SPEC 1 `gate` context). Ordinary, existing behavior; mint never runs on an unshipped item. `journal` records the ship (SPEC 3).

**Step 2 — The worker drafts a candidate check.** The worker reduces the lesson to a single consistency property and drafts a `CheckEntry` with `status: 'candidate'`. Deterministic if the property is mechanizable (§8 decision rule); otherwise a judgment check carrying a **draft** `flake_contract` and a **candidate eval scenario**. The draft carries a `provenance.minted_by` link to the item id and a `lesson` link to the dossier that will receive the reciprocal `mints:` pointer.

**Step 3 — The floor presents it.** `ask(mint)` surfaces the draft as a real choice — **ratify · edit · decline** — a hard-floor act that pauses even in `--auto` (§6). The agent drafts; the human ratifies. This is the safety self-improving loops lack (VISION §9): minted enforcement cannot quietly entrench a mistake.

**Step 4 — On ratify, `registerRatified` (§13.2) performs three side-effects as one atomic, journal-keyed unit (§6.2), in this order:**
   1. **Land (stage) the eval scenario** in the harness (§9 handoff) — done **first** so SPEC 1's ratify guard is satisfiable: `candidate→active` requires, for a judgment check, that `flake_contract.eval_scenario` resolves to a real file (SPEC 1 §7 transition table + §8 assertion 3). A deterministic mint carries no such guard but still stages its golden-gate scenario here, so the learning loop is itself regression-protected.
   2. **Register** — `advanceLifecycle({ transition: 'ratify', floorApproval: true })` (SPEC 1) sets `status: active` and stamps `provenance.ratified`; the entry persists as a YAML file in the content ring, **activating its declared context(s)** — the `contexts` were *declared* at draft time (SPEC 1's schema requires ≥1) and become the contexts the check actually *runs* in on ratify.
   3. **Write the lesson `mints:` pointer** (§7) — memory and enforcement are now bound.

Because all three share one `journal_key` (§6.2), a crash mid-sequence replays as a no-op — a partial ratify never leaves an `active` judgment check whose eval scenario is missing (which the meta-check would immediately file as a `gap`, SPEC 1 §8 assertion 3).

On **edit**, the floor re-drafts (`advanceLifecycle` `edit`, stays `candidate`). On **decline**, the candidate is *discarded, never persisted* (`advanceLifecycle` `decline` → `{ check: null }`); no side-effects fire.

### 4.1 The candidate-check draft shape (SPEC-2 owned)

A draft is a `CheckEntry` (SPEC 1 §4, frozen) with `status: 'candidate'` and `provenance.ratified` **unset until step 4** — wrapped with the two things the floor needs to rule and the mint needs to land:

```ts
// runtime/engine/backward/schema/candidate-draft.ts — ring-1, project-agnostic
import type { CheckEntry, EvaluatorKind } from '../../schema/check.schema';

interface EvalScenarioDraft {                 // ALWAYS present (CandidateDraft.eval_scenario is non-optional):
                                              //   deterministic ⇒ the golden-gate good/bad corpus (target_pass_rate ≡ 1.0, NO flake_contract);
                                              //   judgment      ⇒ ALSO the calibration corpus that seeds entry.flake_contract
  path: string;                               // where it WILL land: runtime/eval/scenarios/<id>.scenario.mjs
  fixtures: { good: string[]; bad: string[] };// known-pass / known-fail inputs (the golden / calibration corpus)
  target_pass_rate: number;                   // judgment-only knob: on ratify, flake_contract.allowed_flake_rate = 1 - target_pass_rate
                                              //   (SPEC 1's allowed_flake_rate is a flake BUDGET — the COMPLEMENT of the pass rate).
                                              //   deterministic ⇒ 1.0 ⇒ budget 0, no flake_contract.
}

interface CandidateDraft {
  entry: CheckEntry;          // status: 'candidate'; provenance.minted_by + provenance.lesson set;
                              //   provenance.ratified === '' (stamped by advanceLifecycle on ratify)
  eval_scenario: EvalScenarioDraft;   // deterministic: golden-gate good/bad fixtures;
                                      //   judgment: ALSO seeds entry.flake_contract
  rationale: string;          // WHY this fix warrants a permanent guard (the §8 mint-heuristic answer,
                              //   surfaced to the floor and journaled into the decision record)
  supersedes_candidate?: string;  // CheckId if this draft would REPLACE an existing guard (a superseding
                              //   mint — routes the floor to the curate-supersede branch, §5)
}
```

**A full worked candidate draft (deterministic — first content-ring, dogfood lesson #1):**

```yaml
# DRAFT held by the worker; persists ONLY on ratify → runtime/content/checks/no-ddb-scan.yaml
entry:
  id: no-ddb-scan
  property: >
    No file under services/**/src/** references ScanCommand, .scan(, or scanAll, and no
    FilterExpression names a GSI key attribute (__typename, tenantId, timestamp).
  kind: drift                 # a continuously-true "this construct never appears" invariant broke
  evaluator:
    type: deterministic
    run: "node tools/check-no-ddb-scan.mjs"
  cost_tier: cheap            # syntactic scan of service src
  contexts: [invariant, gate] # cheap-by-construction ⇒ rides EVERY wake (tension (b))
  scope:
    paths: ["services/**/src/**/*.ts"]
    dossiers: ["MEMORY/feedback_no_scan_no_filter.md"]
  status: candidate           # ← the draft; floor rules next
  provenance:
    minted_by: "no-ddb-scan-guard"        # the item whose ship drafted this
    lesson: "MEMORY/feedback_no_scan_no_filter.md"
    ratified: ""                          # stamped on ratify
eval_scenario:
  path: "runtime/eval/scenarios/no-ddb-scan.scenario.mjs"
  fixtures:
    good: ["fixtures/svc-gsi-query.ts"]            # a KeyConditionExpression query → 0 findings
    bad:  ["fixtures/svc-scan-command.ts",         # a ScanCommand → 1 drift finding
           "fixtures/svc-filter-on-typename.ts"]   # FilterExpression on __typename → 1 drift finding
  target_pass_rate: 1.0       # deterministic ⇒ golden gate, no flake budget
rationale: >
  Mechanizable (a fixed forbidden-token set), guards a recurring failure class (table-scan cost blowups),
  and the property is still intended. Meets all three §8 mint gates.
```

The judgment variant is identical in shape but `entry.evaluator.type: 'judgment'`, and on ratify `entry.flake_contract.allowed_flake_rate` is set to **`1 - eval_scenario.target_pass_rate`** — SPEC 1's `allowed_flake_rate` is a flake BUDGET (the complement of a pass rate), so a `target_pass_rate: 0.95` stores as `allowed_flake_rate: 0.05`, never `0.95`. `eval_scenario.fixtures` becomes the calibration corpus (SPEC 1 §4 second worked entry).

---

## 5. Curate — two triggers, one floor decision + the supersession-chain shape

Curate advances an `active` guard to `superseded` or `retired`. **Two mechanically distinct triggers feed one floor decision** (VISION §9); the floor presentation and the state transition are identical regardless of which trigger fired.

### 5.1 Trigger (i) — SYNCHRONOUS, at the ship gate (BLOCKING)

A property the active item *deliberately* changed makes an existing guard **fail** — which would otherwise block the ship (VISION law 5, "evidence before done"). The worker recognizes the failure as **intended** and drafts the delta before ship completes.

- **The default is always "make the code green."** A failing guard is presumed *right*; the code is presumed *wrong*. Lowering a guard is the **argued exception** — the worker must state, in the `rationale`, why the guarded property is no longer intended.
- **Resolved within the same item's ship** — on-scope, not a pivot (§3). The floor decision (retire/supersede) *is* the sanctioned way past the failing guard; without it, the ship is blocked.

*Grounded example (first content-ring):* a later item introduces a reviewed, narrow `FilterExpression` on a **non-key** attribute where `no-ddb-scan`'s token scan false-positives. The guarded property ("no FilterExpression at all in this region") was too broad; the worker drafts a **superseding** `no-ddb-scan` v2 whose property flags FilterExpression only on the three GSI **key** attributes. The floor supersedes v1 → v2.

### 5.2 Trigger (ii) — ASYNCHRONOUS, via the watch engine (NON-blocking)

The meta-check's **dangling-scope detector** (SPEC 1 §8 rot-detector i) finds a guard whose `scope.paths` globs resolve to **zero files** — it guards code that is gone — and files a `staleness` finding (SPEC 1 `Finding`), a *retirement candidate*. Intake (SPEC 3) routes it to a future item like any other finding; **this path never gates an unrelated ship.**

*Grounded example:* when `advisory-ctrl` was removed (33→32 services), any check whose `scope.paths` pointed at `services/advisory/advisory-ctrl/**` now resolves to nothing → dangling-scope `staleness` finding → routed to an item → floor retires it. **The meta-check never advances state itself** (SPEC 1 §8) — it only files the finding; `active → retired` waits for the floor.

### 5.3 The one floor decision + the supersession-chain shape

Either trigger presents the same choice — **retire · supersede · keep** (§6):

- **keep** (the default for a suspicious sync failure) — the failure stands; the code must satisfy the guard. No state change.
- **retire** — the property is fully abandoned. `advanceLifecycle({ transition: 'retire', floorApproval: true })` sets `status: retired`, records `provenance.retired_reason`. The lesson's `mints:` entry flips to `retired` in the same act.
- **supersede** — a narrower/updated property survives. A **successor** check is registered `active` in the same floor act; `advanceLifecycle({ transition: 'supersede', floorApproval: true, successor })` writes the `supersedes`/`superseded_by` chain on **both** entries. The lesson's `mints:` pointer is re-aimed at the successor.

**The supersession-chain shape** — expressed entirely through the frozen `Provenance.supersedes`/`superseded_by` (SPEC 1 §4); nothing new stored, only the chain written on both sides. Worked example (the sync case above):

```yaml
# runtime/content/checks/no-ddb-scan.yaml        — the OLD guard, now terminal
id: no-ddb-scan
status: superseded            # ← terminal state, NOT deleted (history stays legible)
provenance:
  minted_by: "no-ddb-scan-guard"
  lesson: "MEMORY/feedback_no_scan_no_filter.md"
  ratified: "2026-07-02"
  superseded_by: no-ddb-scan-v2         # ← forward link written by advanceLifecycle(supersede)

# runtime/content/checks/no-ddb-scan-v2.yaml      — the SUCCESSOR, registered active in the same floor act
id: no-ddb-scan-v2
property: >
  No ScanCommand/.scan(/scanAll under services/**/src, and no FilterExpression on a GSI KEY attribute
  (__typename, tenantId, timestamp) — a reviewed FilterExpression on a NON-key attribute is allowed.
status: active
provenance:
  minted_by: "narrow-ddb-filter-allowance"   # the item that argued the delta
  lesson: "MEMORY/feedback_no_scan_no_filter.md"
  ratified: "2026-09-11"
  supersedes: no-ddb-scan                     # ← backward link (the chain, both sides)
```

**Rules the chain enforces** (SPEC 1 §7): `superseded`/`retired` are terminal *states*, never deletions; the chain keeps "what the project still intends" (`status: active`) distinct from "everything ever minted"; and the lesson↔check `mints:` link is reconciled in the *same* floor act (§7) so memory and enforcement never diverge.

---

## 6. The floor protocol — the `ask(decision)→choice` payloads + the decision record

Both arms surface through the `ask(decision)→choice` capability (SPEC 3 §4). **Both are hard-floor acts** (VISION §13.4: "enforcement itself is a floor act"): because a check is *permanent* enforcement, creating or removing one **pauses even in `--auto`** — `--auto` never self-ratifies, self-retires, or self-registers (VISION §9).

**The surface is a real choice widget, never prose:** a bounded set of options with exactly one marked recommended; a free-text "your call" prose pause is a protocol violation. The concrete widget is the *harness's* binding behind seam #1 — in a headless eval harness the act degrades to the `<<HARNESS-PAUSE: reason>>` sentinel (SPEC 3). What ring-1 fixes is only that the pause is a structured, recommended-bearing choice.

> *First content-ring example (Nestfolio + Claude Code — NOT ring-1):* the choice renders as an `AskUserQuestion` whose recommended option carries the literal `(Recommended)` suffix in its label (dossier `MEMORY/feedback_askuserquestion_mark_recommended.md`), and the pause-even-in-`--auto` discipline mirrors the existing `backlog-next-epic` hard floor, where irreversible / outward-facing acts already pause under `--auto`.

### 6.1 The two choice payloads (SPEC-2 owned)

```ts
// runtime/engine/backward/schema/floor-choice.ts — ring-1
import type { CheckEntry, Provenance, Finding } from '../../schema/check.schema';

interface MintChoice {
  act: 'mint';
  candidate: CheckEntry;          // status: 'candidate' (the §4.1 draft's entry)
  lesson: string;                 // dossier that will receive `mints:` on ratify
  rationale: string;              // the worker's argument for permanent enforcement
  recommended: 'ratify';          // (Recommended) — deterministic-first drafts default to ratify
  options: ['ratify', 'edit', 'decline'];
}

interface CurateChoice {
  act: 'curate';
  guard: CheckEntry;              // the active check that failed / dangled
  trigger: 'ship-gate-blocking' | 'dangling-scope';
  finding: Finding;               // the guard-fail (sync) or staleness (async) finding
  proposed_successor?: CheckEntry;// present iff the worker drafted a supersession delta
  rationale: string;              // for sync: WHY the guarded property is no longer intended
  recommended: 'keep' | 'supersede' | 'retire';
  //   sync default = 'keep' (guard presumed right); async dangling-scope default = 'retire'
  options: ['retire', 'supersede', 'keep'];
}

type FloorChoice = MintChoice | CurateChoice;
```

The `(Recommended)` option weights the most reusable/generalizable outcome (CLAUDE.md Hard Constraints — reusability breaks ties): a deterministic mint draft recommends `ratify`; a dangling-scope curate recommends `retire`; a suspicious sync guard-fail recommends `keep` (the code, not the guard, is presumed wrong).

### 6.2 The decision record (journaled — SPEC-2 owned)

Every floor act — mint or curate — produces an append-only `FloorDecision`, journaled for legibility (VISION law 9: "what enforcement exists and why"). It is the asynchronous-review surface: it lands in the `journal` (SPEC 3), is rendered into the PR body at epic ship (the existing `--auto` decision-log render), and its provenance is the permanent audit trail on the check itself.

```ts
// runtime/engine/backward/schema/floor-decision.ts — ring-1
interface FloorDecision {
  act: 'mint' | 'curate';
  transition: 'ratify' | 'edit' | 'decline' | 'supersede' | 'retire' | 'keep';
  check: string;                  // CheckId: the candidate (mint) or the guard (curate)
  successor?: string;             // CheckId: supersede only
  lesson?: string;                // dossier reconciled (mint ratify / curate retire|supersede)
  rationale: string;              // the argued reason (REQUIRED for retire/supersede/decline)
  provenance: Provenance;         // the backward-edge link recorded on the check
  decided_by: 'human';            // ALWAYS human — mint/curate never self-resolve in --auto
  decided_at: string;             // ISO-8601
  journal_key: string;            // idempotency key (SPEC 3 journal). TERMINAL at-most-once transitions
                                  //   (ratify · decline · supersede · retire): "<act>:<check>:<transition>" — a
                                  //   collision IS a crash-replay ⇒ no-op. REPEATABLE transitions (edit · keep):
                                  //   "<act>:<check>:<transition>:<item>:<attempt>" — the driving item id + a
                                  //   monotonic attempt counter keep a legitimate re-draft / re-keep distinct from a replay.
}
```

**Idempotency (SPEC 3 `journal`).** Each floor act is keyed by `journal_key`. For the **terminal, at-most-once** transitions (`ratify`/`decline`/`supersede`/`retire`) a replay after a `/clear` or crash finds the transition already applied (the check is already `active`/`retired`, the lesson already reconciled) and is a **no-op**, not a double-mint. The **repeatable** transitions — `edit`'s re-draft loop (§4/§11.1-5) and `keep`'s recurring no-op (§5, re-triggered across different items/ships) — carry the driving item id + a monotonic attempt counter in the key, so a legitimate second occurrence is never mistaken for a replay and silently swallowed. This is the amended Law 6 (SPEC 3): resume is replay, not a fragile save-point.

---

## 7. Enforcement-as-memory — the `mints:` pointer + the checkable subset

This is the move passive-retrieval memory does not make (VISION §7; TARGET-ARCH §7): a lesson does not merely *remind* — its mechanizable fraction *enforces*, via a registered check that fails the build.

### 7.1 The `mints:` pointer format

A lesson dossier is git-native markdown with YAML frontmatter (`name` / `description` / `type: feedback`). Enforcement-as-memory adds one field — the reciprocal of the check's `provenance.lesson`:

```yaml
---
name: No scans, no FilterExpression on key attributes
description: Never use DynamoDB Scan operations or FilterExpression on GSI key attributes
type: feedback
mints:                          # ← the enforcement-as-memory binding (append-only, floor-reconciled)
  - check: no-ddb-scan
    ratified: 2026-07-02
    status: superseded          # kept legible; superseded by the successor below
    superseded_by: no-ddb-scan-v2
  - check: no-ddb-scan-v2
    ratified: 2026-09-11
    status: active
---
Never use DynamoDB Scan operations. Never use FilterExpression on GSI key attributes. …(prose unchanged)
```

Each element of the `mints:` list is a typed `MintsEntry`:

```ts
// runtime/engine/backward/schema/mints-entry.ts — ring-1; the reciprocal of the check's Provenance.lesson
interface MintsEntry {
  check: string;                               // CheckId this lesson minted
  ratified: string;                            // ISO date (mirrors the check's provenance.ratified)
  status: 'active' | 'superseded' | 'retired'; // tracks the minted check's live-or-terminal state
  superseded_by?: string;                      // CheckId; set together with status: 'superseded'
}
```

The pointer is **derived-and-reconciled, never hand-edited** (the same contract as `topic_memory ↔ related_workstreams`, grounding), and `reconcileLesson` (§13.2) is its **only** writer. Exactly which fields each transition mutates, all in the *same floor act* that advances the check:

- **mint ratify** — appends a new `MintsEntry { check, ratified, status: 'active' }`.
- **curate retire** — flips that entry's `status` to `'retired'` (no other field changes; nothing removed).
- **curate supersede** — flips the superseded entry to `status: 'superseded'` **and** sets `superseded_by: <successor>`, **and** appends a new `MintsEntry { check: <successor>, ratified, status: 'active' }`.

A lesson↔check that disagree is a `staleness` finding (the meta-check can assert `every lesson mints: entry resolves to a check with the reciprocal provenance.lesson`, and that each entry's `status`/`superseded_by` agree with the check's — SPEC 1 §8 assertion family; wired as a content-ring meta-assertion).

### 7.2 The checkable subset — explicitly NOT totalizing (tension (c))

Enforcement-as-memory is the **checkable subset** of memory, sized to what is mechanizable. The grounded ratio, confirmed against the 58 `feedback_*` lessons:

| Bucket | Count | Disposition |
|---|---|---|
| already mechanized by a live check | ~3-4 | e.g. `backlog_discipline`→`backlog-lint`; `bff_is_read_model`→`read-model-drift` (retro-fit a `mints:` pointer) |
| **mechanizable, prose-only today** | ~13-14 | the mint targets — §10 dogfoods 5 of them |
| **pure retrieval** (why / tradeoff / judgment / behavioral) | **~41** | stay dossiers; NEVER minted — e.g. `cleanest_over_blast_radius`, `measure_before_proposing`, `costs_in_tokens_not_dollars`, the worktree-process family |

So **~17 of 58 (≈30%)** are checkable; **~41 are retrieval-only and must stay so**. The Runtime never claims enforcement replaces reminding — it is the executable subset *alongside* recall (VISION §7). The `~41` are not a backlog of un-minted checks; they are lessons whose force is judgment the model must *retrieve and weigh*, which no pass/fail check can capture. A mint attempt on a retrieval-only lesson is a **category error** the §8 heuristics reject at draft time.

**Why this dodges self-reinforcing error (VISION §7).** A minted lesson's force is a *deterministic (or eval-guarded) check re-evaluated against the code* — not re-injected prose the model can compound a mistake on. The check cannot "hallucinate" its verdict; it runs.

---

## 8. Minting & retirement heuristics (VISION §15.4)

Concrete decision rules — the answer to *when* the rare backward edge fires and *how* it drafts.

### 8.1 When a shipped fix should draft a check (the three-gate mint test)

A fix drafts a candidate check **iff all three** hold (fail any → file/keep a retrieval-only lesson, mint nothing):

1. **Mechanizable** — the "never again" reduces to a single pass/fail property over the codebase (a forbidden-token scan, an AST predicate, a schema conformance, an exit code, or a calibrated judgment with a stable rubric). If the lesson is irreducibly *why/tradeoff/judgment*, it is retrieval-only (§7.2).
2. **Recurring failure class** — the property guards a *class* of failure, not a one-off. Draft test: *"would this check have caught the bug I just fixed, AND would a plausible future variant of the same class trip it?"* A genuinely unique incident is a decision record, not a guard.
3. **Still intended** — the property is one the project means to hold going forward (not a scaffold you are about to remove).

**Most ships pass none of these** — that is the point (§3). The heuristic is deliberately conservative: a false *negative* (missed mint) costs a retrieval-only lesson; a false *positive* (a guard that should not exist) costs permanent carrying weight and a later curate. Bias toward not minting.

### 8.2 The deterministic-vs-judgment choice rule (deterministic-first)

```
mechanizable as a syntactic / AST / structural / schema / exit-code predicate over files?
  ├─ YES → evaluator.type = 'deterministic'   (a tools/check-*.mjs gate — cheap, exact, no flake_contract)
  └─ NO, but a STABLE rubric + a calibrated judge can decide it?
        ├─ YES → evaluator.type = 'judgment'   (REQUIRES draft flake_contract + candidate eval scenario)
        │          └─ AND file it as a standing SUPERSESSION CANDIDATE: when the property later
        │             becomes mechanizable, mint the deterministic successor and supersede this one (§9)
        └─ NO  → NOT a check. Retrieval-only lesson (§7.2).
```

Deterministic-first is enforced by *lifecycle*, not just preference (SPEC 1 §9): a judgment check is born owing a deterministic successor, and the `supersedes` chain records the upgrade when it lands.

### 8.3 When a change surfaces a guard as a retirement candidate

| Trigger | Detector | Default floor recommendation | Transition |
|---|---|---|---|
| the item **deliberately changed** the guarded property | the guard **fails** at the ship gate (sync, §5.1) | `keep` (guard presumed right; retire is the argued exception) | retire *or* supersede |
| the guarded **code is gone** | dangling-scope detector: `scope.paths` → 0 files (async, §5.2; SPEC 1 §8) | `retire` (code gone ⇒ property un-guardable) | retire |
| the property **narrowed/generalized** but survives | worker drafts a `proposed_successor` (either trigger) | `supersede` | supersede |

**Supersession chains are recorded on both entries** (§5.3) and the lesson `mints:` is re-aimed in the same floor act (§7.1). A retired check is never deleted — `status: retired` + `retired_reason` keeps the history legible.

---

## 9. Eval-scenario landing — the handoff contract (harness internals: SPEC 3)

On **ratify** (the eval-scenario landing sub-step of §4 step 4, which runs *before* `advanceLifecycle('ratify')` so the guard is satisfiable) and on a **superseding mint** (a new successor), the check's eval scenario is added to the eval harness so the learning loop is itself regression-protected (VISION §10). **This spec fixes only the landing *handoff*; the harness internals — `defineSuite`, the 3-layer golden/invariant/judge grading, `judge.mjs`, the corpus runner — are SPEC 3.**

```ts
// runtime/engine/backward/schema/eval-landing.ts — ring-1
import type { EvaluatorKind, FlakeContract } from '../../schema/check.schema';

interface EvalScenarioLanding {
  check: string;                  // CheckId the scenario guards
  evaluator_kind: EvaluatorKind;  // 'deterministic' | 'judgment'
  scenario_path: string;          // runtime/eval/scenarios/<check-id>.scenario.mjs (canonical home)
  fixtures: { good: string[]; bad: string[] };  // known-pass / known-fail inputs
  flake_contract?: FlakeContract; // REQUIRED iff judgment — the calibration target the harness regresses
  registered_via: 'harness:landScenario';       // the Spec 3 harness seam (interface only)
}
```

**The handoff contract (what SPEC 2 guarantees the harness receives):**
- **Deterministic checks** land a **golden-gate** scenario: the harness runs the evaluator over `fixtures.good` (asserts 0 findings) and `fixtures.bad` (asserts ≥1 finding of `check.kind`). No `flake_contract` — a deterministic golden gate has real teeth (SPEC 3 grading layer 1).
- **Judgment checks** land a **calibrated** scenario carrying the `flake_contract`: the harness measures the fixtures' **flake rate** (`1 - gatePassRate`) and flags a regression when it **exceeds** `allowed_flake_rate` — equivalently `gatePassRate < 1 - allowed_flake_rate`. `allowed_flake_rate` is SPEC 1's flake BUDGET, **never** a pass-rate floor (SPEC 3 grading; the flake-means-broken discipline).
- **Idempotent landing** — keyed by `check`; a replay does not double-register (SPEC 3 `journal`).

**The reciprocal duty (SPEC 3 owns, cross-referenced):** when the harness finds *its own* gap (a thin judge gate, an uncovered path), that becomes a finding the Runtime files against itself and runs through this same loop (VISION §10). The `flake_contract` a judgment mint drafts is the seed the harness later hardens.

---

## 10. The dogfood plan — five real lessons, proven FIRST (VISION §15)

Per the SPEC REVIEW ("prove the backward edge first") and VISION §15 sequencing, the moat is validated **end-to-end on five real, mechanizable, prose-only `feedback_*` lessons** — each run `draft → floor-ratify → register → eval` — *before* the forward loop widens or the seams generalize. All five are deterministic, single-property, and have **no `tools/check-*` today** (grounding confirmed), so they exercise the mint path with zero cross-file ambiguity. **This table is Nestfolio content behind seam #2 — not part of ring-1.**

| Lesson (dossier) | Candidate check `id` | `property` (one sentence) | `evaluator` | `kind` | `contexts` | Eval-scenario sketch (good → 0 · bad → finding) |
|---|---|---|---|---|---|---|
| `feedback_no_scan_no_filter` | `no-ddb-scan` | No `ScanCommand`/`.scan(`/`scanAll` under `services/**/src`, no `FilterExpression` on a GSI key attr (`__typename`/`tenantId`/`timestamp`). | deterministic | drift | `[invariant, gate]` | GSI `KeyConditionExpression` query → 0 · a `ScanCommand` + a `FilterExpression` on `__typename` → 2 drift findings |
| `feedback_no_silent_fallback_in_agent_results` | `no-agent-result-fallback` | No `?? {}` / `?? []` fallback on a value read from an AgentCore/orchestrator invocation result, in advisory agent services. | deterministic | drift | `[invariant, gate]` | `throw new EmptyAgentResponseError` on missing key → 0 · `result.userGoals ?? {}` → 1 drift finding |
| `feedback_no_seeder_fixtures` | `no-ddb-seed-in-integration` | No `DdbSeedFixture`/`AccountSeedingFixture`/direct DDB write (`PutItem`/`BatchWrite`/DocumentClient `.put`) under `services/**/test/integration/**`. | deterministic | drift | `[invariant, gate]` | fixture seeded via EventBridge/AppSync → 0 · a `DdbSeedFixture` import → 1 drift finding |
| `feedback_prefer_libraries_over_casts` | `no-unsafe-casts` | No `as unknown as`, `as any`, or `eslint-disable` in production source (`services`/`libs`/`apps` `**/src`, excluding `test/**`). | deterministic | drift | `[invariant]` | `aws-sdk-client-mock` typing → 0 · `as unknown as Foo` → 1 drift finding |
| `feedback_states_runtime_uncatchable` | `no-states-runtime-catch` | No Step Functions `Catch`/`Retry` whose `ErrorEquals` includes `States.Runtime`. | deterministic | drift | `[invariant, gate]` | `Choice`-on-`isPresent` absent-row tolerance → 0 · a `Catch` listing `States.Runtime` → 1 drift finding |

**All five carry `kind: drift`** — each is a *forbidden-construct-present* guard ("this construct never appears"), which SPEC 1 §5 fixes as `drift` (the continuously-true invariant broke), not `gap` (missing-required-thing) or `inconsistency` (two-sources-disagree). `Finding.kind` inherits `check.kind`, so the failures label as `drift` too.

**Two things the dogfood proves for ring-1:**
- **The reusable gate template is real.** All five mint a `tools/check-*.mjs`-shaped evaluator — *pure-fn tool + optional JSON exclusion sidecar + `node:test` tmpdir tests* — the de-facto template SPEC 1 §12 formalizes. `no-ddb-scan` and `no-unsafe-casts` want no sidecar; `no-agent-result-fallback` and `no-ddb-seed-in-integration` want a scope-narrowing sidecar (the `read-model-exclusions.json` precedent), directly reusing the existing pattern.
- **The curate arm has a real content example.** `no-ddb-scan` → `no-ddb-scan-v2` (§5.1) is a genuine sync-supersede; a service deletion (`advisory-ctrl`) is a genuine async dangling-scope retire (§5.2). Both are dogfooded, not hypothetical.

**A sixth, if a judgment mint is wanted** (grounding alternate): the existing `audit-integration-test` skill is a `judgment` check (`integration-test-completeness`, SPEC 1 §4) whose multi-part `property` *includes* the seed-fixture rule that `no-ddb-seed-in-integration` mechanizes. SPEC 1's `supersede` is **whole-check** — it moves the entire check `active→superseded` with exactly one successor; there is no mechanism to retire a single sub-check of a judgment evaluator. So the canonical judgment→deterministic upgrade (§8.2) is: mint the deterministic `no-ddb-seed-in-integration` **alongside** a re-authored successor to `integration-test-completeness` whose `property` is **narrowed to exclude** the seed rule (handing that sub-check to the deterministic guard), then supersede the old judgment check by that re-scoped successor — one floor act, both arms proven on one real pair. The `property` must be re-written; "supersede the seed portion" is not expressible.

---

## 11. Validation strategy (TDD / eval scenarios)

Two layers, distinguished per house convention:
- **Deterministic golden gates** — `node --test` over the SPEC-2 helpers (`draftCandidate`, `presentFloor`, `registerRatified`, `curateGuard`, `reconcileLesson`, `landEvalScenario`), importing pure cores directly. These are the teeth.
- **Procedure eval scenarios** — the mint/curate *procedures* are Runtime procedures graded by the eval harness (SPEC 3) using the call-log + end-state planes and the `<<HARNESS-PAUSE>>` sentinel for floor acts. Each asserts a terminal kind (`pause` / `completed`), positive **and** negative.

Run the golden gates: `node --test runtime/engine/backward/test/*.test.mjs`.

**The six procedure helpers — typed signatures (ring-1, mirroring SPEC 1 §11; house convention: pure named-export core + thin `main()`, no default exports, tests import the pure core directly):**

```ts
// runtime/engine/backward/ — SPEC-2 procedure helpers
draftCandidate({ item, lesson })                              → CandidateDraft | null
//   §4 step 2 · null = the §8 category-error reject (a retrieval-only lesson drafts nothing)
presentFloor({ choice })                                     → { choice: FloorChoice; sentinel?: string }
//   §6 · binds ask(); in --auto / headless returns the <<HARNESS-PAUSE>> sentinel, never self-resolves
registerRatified({ draft, floorApproval })                  → { check: CheckEntry; decision: FloorDecision; landing: EvalScenarioLanding }
//   §4 step 4 · ATOMIC journal-keyed unit: landEvalScenario → advanceLifecycle('ratify') → reconcileLesson
curateGuard({ guard, trigger, successor?, floorApproval })  → { check: CheckEntry; successor?: CheckEntry; decision: FloorDecision }
//   §5 · wraps advanceLifecycle('retire' | 'supersede') + reconcileLesson
reconcileLesson({ lesson, check, transition, successor? })  → { lesson: string; mints: MintsEntry[] }
//   §7.1 · the ONLY writer of the mints: pointer; returns the reconciled list
landEvalScenario({ draft })                                 → EvalScenarioLanding
//   §9 handoff · idempotent, keyed by check id
```

Every helper refuses to advance state without `floorApproval === true` (it delegates the guard to `advanceLifecycle`, SPEC 1 §11 — `event: 'REFUSED_NO_FLOOR'`).

### 11.1 Mint procedure (given / when / then) ×6

1. *given* a shipped item + a mechanizable lesson passing all three §8 gates · *when* the mint procedure runs · *then* `draftCandidate` returns a `CandidateDraft` with `entry.status: 'candidate'`, `evaluator.type: 'deterministic'`, `provenance.minted_by` = the item id, `provenance.ratified === ''`.
2. *given* a candidate draft presented at the floor · *when* the human answers **ratify** · *then* the check persists as `status: active` with `provenance.ratified` stamped, `landEvalScenario` is called once, and the lesson gains a `mints:` entry — **all three side-effects** (state plane: file exists + lesson frontmatter changed).
3. *given* the same, **but in `--auto`** · *when* the floor act is reached · *then* the run emits `<<HARNESS-PAUSE: mint no-ddb-scan>>` and stops — **`--auto` never self-ratifies** (terminal kind: `pause`; negative: no check file written, no `mints:` entry).
4. *given* a candidate + floor answer **decline** · *when* advance · *then* `advanceLifecycle` returns `{ check: null }`, **no** YAML persists, **no** eval scenario lands, **no** `mints:` entry (negative: none of the three side-effects fire).
5. *given* a candidate + floor answer **edit** · *when* advance · *then* `status` stays `candidate`, the draft is re-presented (no persistence yet).
6. *given* a lesson that is **retrieval-only** (fails §8 gate 1, e.g. `cleanest_over_blast_radius`) · *when* the §8 mint test runs · *then* **no candidate is drafted** (mint is a category error; the lesson stays a dossier).

### 11.2 Curate — SYNCHRONOUS ship-gate trigger (given / when / then) ×4

1. *given* an item whose sanctioned diff makes `no-ddb-scan` fail at the ship gate · *when* the worker classifies the failure as intended and drafts a `proposed_successor` · *then* the floor is presented a `CurateChoice` with `trigger: 'ship-gate-blocking'`, `recommended: 'keep'`.
2. *given* that choice + floor answer **supersede** · *when* `curateGuard` runs · *then* `no-ddb-scan.status: superseded` with `superseded_by: no-ddb-scan-v2`, the successor `active` with `supersedes: no-ddb-scan`, and the lesson `mints:` re-aimed at v2 — **one floor act** (state plane: both YAMLs + lesson reconciled).
3. *given* the guard fails but the failure is **NOT** intended (default) · *when* the floor answers **keep** · *then* **no state change**; the ship stays blocked until the code is green (negative: `no-ddb-scan` remains `active`).
4. *given* `--auto` at the sync curate floor · *when* reached · *then* `<<HARNESS-PAUSE: curate no-ddb-scan>>` — lowering a guard is a hard-floor act (terminal kind: `pause`).

### 11.3 Curate — ASYNCHRONOUS dangling-scope trigger (given / when / then) ×3

1. *given* a check whose `scope.paths` resolve to **0 files** (code deleted) · *when* the watch-engine meta-check runs · *then* it files exactly one `staleness` finding tagged *retirement-candidate* and the check `status` **remains `active`** (the meta-check never advances state — SPEC 1 §8).
2. *given* that finding routed to an item and worked · *when* the floor answers **retire** · *then* `status: retired`, `provenance.retired_reason` recorded, the lesson `mints:` entry flipped to `retired` — nothing deleted (state plane).
3. *given* the async trigger fired · *when* an *unrelated* item ships concurrently · *then* that ship is **not** gated by the dangling guard (negative: async curate never blocks an unrelated ship — §5.2).

The validation gate for the dogfood (§10) is the five golden-gate scenarios plus the sync-supersede and async-retire procedure scenarios, all green — deterministic, no live e2e (distinct from the flake-guarded judgment coverage a future judgment mint would add).

---

## 12. Out of scope

**In scope (this spec):** the two floor-gated procedures (mint post-ship; curate sync + async); the `CandidateDraft`, `FloorChoice`, `FloorDecision`, `EvalScenarioLanding` shapes and the `mints:` pointer format; the checkable-subset framing + ratio; the minting/retirement heuristics; the eval-scenario *landing handoff*; the five-lesson dogfood plan; TDD/eval scenarios for mint + both curate triggers.

**Out of scope (owned elsewhere):**

- **The `CheckEntry` / `Provenance` / `Finding` / `Item` schemas, the `CheckStatus` enum, and `advanceLifecycle` itself.** → **SPEC 1** (frozen; consumed verbatim). This spec adds only the procedures that call them and the SPEC-2-owned draft/choice/decision/landing wrappers.
- **The eval-harness internals** — `defineSuite`, the golden/invariant/judge 3-layer grading, `judge.mjs`, the corpus runner, calibration mechanics. → **SPEC 3** (this spec fixes only the §9 landing *interface*).
- **The `ask(decision)→choice` capability binding + the `<<HARNESS-PAUSE>>` sentinel formalization**, and the `journal` idempotency keying/replay scheme. → **SPEC 3** (this spec consumes them by contract: floor acts pause; decisions are journaled + idempotent).
- **The watch engine's dangling-scope detector mechanics** and the intake router that turns its `staleness` finding into an item. → **SPEC 1 §8** (the detector) + **SPEC 3** (intake). This spec consumes the resulting `Finding`.
- **The scope-gate check mechanics** (diff ⊆ declared scope, tension (d)). → **SPEC 3**. This spec only relies on it to keep mint/curate on-scope (§3).
- **Physically migrating the 34 live surfaces to YAML** and relocating `tools/*-exclusions.json`; **retro-fitting `mints:` onto the ~3-4 already-mechanized lessons.** That is realization, not this design.
- **The starter check library / cold-start on-ramp** and the operational/rendering surface (VISION §15.5–15.6). **Product name.**

---

## 13. Build sequence / dependencies

The moat, **built and proven first** (VISION §15) — but *after* SPEC 1's registry exists, since every procedure here drives `advanceLifecycle` and reads the frozen schema.

1. **SPEC 1 — the registry & ring-1 helpers.** *Hard prerequisite.* Nothing in this spec typechecks until `CheckEntry` / `Provenance` / `Finding` / `CheckStatus` / `advanceLifecycle` exist. Ring-1 only, no content.
2. **SPEC 2 (this) — the backward edge, dogfooded first.**
   1. The SPEC-2 shapes: `CandidateDraft`, `FloorChoice`, `FloorDecision`, `EvalScenarioLanding`, the `mints:` pointer.
   2. The ring-1 procedure helpers under `runtime/engine/backward/` (house convention: `#!/usr/bin/env node`, JSDoc header, pure named-export core + thin `main()`, no default exports; tests import pure cores): `draftCandidate`, `presentFloor` (binds `ask`, degrades to sentinel), `registerRatified` (wraps `advanceLifecycle(ratify)` + `landEvalScenario` + `reconcileLesson`), `curateGuard` (wraps `advanceLifecycle(retire|supersede)` + `reconcileLesson`), `reconcileLesson`, `landEvalScenario` — each with §11 golden gates.
   3. **Dogfood** the five real lessons (§10) end-to-end: `draft → floor-ratify → register → eval`, plus the sync-supersede (`no-ddb-scan`→v2) and the async-retire (dangling-scope) proofs. This is the moat's proof-of-life — the §15 "prove it first on a handful of real lessons" milestone.
3. **SPEC 3 — the forward edge & seams.** Widens the loop: watch engine, intake, planner, the six capability interfaces (incl. the `ask` binding + `<<HARNESS-PAUSE>>` and the `journal` this spec relies on), the eval-harness home for the scenarios §9 lands, and the equivalence map that migrates the 34 surfaces.

**Dependency rule:** ring-1 (the backward-edge *protocol*) never depends outward — not on any harness (the `ask`/`journal` bindings are behind SPEC 3's capability seam) and not on any project content (the five lessons and their checks are seam #2). The lessons/checks are content-ring examples; the two-arm floor-gated protocol is the project-agnostic moat.
