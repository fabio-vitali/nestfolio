# Runtime SPEC 1 — the check registry & the hybrid atom (design)

**Date:** 2026-07-01
**Status:** design — approved-in-vision; ring-1 core, foundational (SPECs 2 & 3 consume this schema verbatim)
**Workstream:** `runtime-realization` — SPEC 1 of the moat-first three-spec set (ring-1 engine core)
**Inputs:** VISION `docs/vision/long-horizon-engineering-runtime.md` (§5 the atom, §6 the registry, §13.2 derive-don't-store, §13.3 deterministic-first); TARGET-ARCH `docs/superpowers/specs/2026-06-30-long-horizon-runtime-target-architecture-design.md` (§2 the hybrid atom, §5 the registry, §11 equivalence map); VISION REVIEW `docs/reviews/2026-07-01-long-horizon-runtime-vision-review.md` (the 5 surviving tensions); SPEC REVIEW `docs/reviews/2026-06-30-long-horizon-runtime-spec-review.md`.
**Consumed by:** SPEC 2 `docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md` (mint/curate/floor); SPEC 3 `docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md` (watch/intake/planner/execution + equivalence map).
**Hard constraint:** ring-1 stays **project- and harness-agnostic.** Every Nestfolio-specific artifact (the `backlog-*` invariants, the `tools/check-*.mjs` drift gates, the `feedback_*` lessons) appears **only** as a clearly-quarantined *first content-ring* example behind the project seam (§12).
**Locked decisions:** (1) **hybrid atom** — check = atom of consistency, item = atom of work, the loop converts between them; (2) **deterministic-first** — judgment is the guarded fallback, never the default; (3) **derive-don't-store** — any stored knob is itself a checked property; (4) **lifecycle transitions happen only at the floor** — mint *and* retire are the developer's, never drift.

---

## 1. Problem

The reference implementation already runs **34 distinct consistency checks across 5 unrelated mechanisms** — and there is **no single registry, no shared severity vocabulary, and no shared evaluator interface.** Grounded inventory, as of 2026-07-01:

| Mechanism | Surfaces | Where it lives | Shared with the others? |
|---|---|---|---|
| `backlog-lint` node runner | 16 (11 numbered rules + parseable precondition + captured-audit + 2 named judgment gaps) | `.claude/skills/backlog-lint/lib/rules.mjs` | no |
| `tools/check-*.mjs` drift gates | 5 (`read-model-drift`, `card-drift`, `typed-subject-drift`, `typed-fixtures`, `no-appsync-literals`) | `tools/check-*.mjs` + JSON exclusion sidecars | no |
| pre-commit structural hook | 7 own checks (+ delegates 3 to the gates) | `scripts/verify-structure.sh` | no |
| eslint module boundaries | 1 (`@nx/enforce-module-boundaries`) | `eslint.config.js` | no |
| `audit-*` LLM skills | 5 (`audit-service`/`-domain`/`-system`/`-integration-test`/`-e2e-test`) | `.claude/skills/audit-*/SKILL.md` | no |

**The symptoms this scatter produces:**

- **No provenance.** Not one of the 34 records *which lesson or item minted it* — so the backward edge (SPEC 2) has nowhere to deposit what the system learns, and no check can be traced to the failure it prevents.
- **Wiring surprises that only a registry would catch.** `check-typed-fixtures.mjs` has **no nx target** — it exists *only* as pre-commit check #9. The nx drift targets live in `libs/event-processor/project.json` and there are **three** (not the two the definition assumed), and the target is named `card-drift` while the tool is `check-service-card-drift.mjs`. **No** drift target is wired into CI or into `nx.json` `targetDefaults`. Enforcement today = pre-commit hook + manual `nx` runs + a human remembering to invoke an `audit-*` skill. These are exactly the inconsistencies a self-checking registry surfaces as findings.
- **No lifecycle.** A check is immortal by default: nothing retires a guard whose guarded property was deliberately changed, and nothing surfaces a guard whose code is gone. A pile of stale-but-green checks is itself drift — the thing the system exists to fight (VISION REVIEW A1).
- **Two evaluator worlds, no shared word.** 26 surfaces are deterministic (a script exits non-zero); 8 are judgment (an agent sweep). `audit-integration-test`/`audit-e2e-test` are internally grep-based checklists that *could* be lifted into deterministic gates — but nothing records that they are near-deterministic, or holds the genuinely-judgment ones to a flake budget.

**The one thing to build:** a single **check registry** — the library every other layer reads — with a schema rich enough to carry provenance, a lifecycle the floor curates, and a meta-check that keeps the registry itself honest. This spec defines that schema and its ring-1 helpers. It builds **nothing project-specific**; §12 shows the 34 surfaces *mapped onto* the schema as the first content-ring, quarantined behind the project seam.

---

## 2. Decisions (locked in vision; restated here as build premises)

Each decision names the failure it answers **and the reusable pattern it establishes** — pattern-reuse is the primary objective (CLAUDE.md Hard Constraints).

1. **The atom is hybrid, and the loop is the conversion.** A *check* is the atom of consistency; an *item* is the atom of work; `check→finding→item` (forward) and `item→check` (backward) are the edges. Establishes the reusable *"consistency and work are dual, joined by a queue"* pattern — neither subsystem is subordinate, so the same registry serves both proactive audits and reactive gates (VISION §5).

2. **Deterministic-first; judgment must *earn* the word "check."** If a property can be a script, it is one. A judgment check is admissible only when it carries a `flake_contract` + an eval scenario (§9). Establishes the reusable *"non-determinism is declared in the data model, never hidden behind a slogan"* pattern (VISION §6, honoring tension **(e)**).

3. **Derive, don't store — and every stored knob is itself checked.** The registry stores only irreducible declarations (a check's `id`, `property`, `kind`, `scope`, `status`, `provenance`); everything else (which context a check *defaults* to, the priority of a finding, rollups) is computed. A stored knob with no validating check is *forbidden* — the meta-check (§8) files it as a finding. Establishes the reusable *"configuration is a checked property, not trusted state"* pattern (VISION §13.2).

4. **Lifecycle transitions happen only at the floor.** `candidate→active` (mint) and `active→superseded|retired` (curate) are **the same kind of decision** — the developer's — and both go through `ask(decision)` (SPEC 3 §4). Nothing drifts past a guard; nothing auto-registers one. Establishes the reusable *"enforcement is curated at a human floor, minted **and** retired"* pattern — the answer to tension **(a)**: monotonic hardening is **net-hardening with a curation cost**, never mint-only.

5. **`contexts` records the truth; the library — not the check — is omnipresent.** "One check, three contexts" is a property of the *library*. Cost forces most checks into one context; the registry stores the real subset, not the slogan (VISION §6, honoring tension **(b)** and the review's A4).

6. **Scoping economizes retrieval, never enforcement.** The scoped-wake helper (`findByScope`, §11) narrows *dossiers and expensive audits* — but the cheap global invariant gates **always ride the wake**. Establishes the reusable *"cheap-by-construction invariants are never scoped away"* pattern (VISION §7/§8, honoring tension **(b)**).

These were confirmed at the vision layer; this spec derives the data shapes and helpers from them and does **not** revisit them.

---

## 3. The hybrid atom (concrete)

The Runtime has two atoms and a conversion. This section makes each one a concrete type.

**A *check* is the atom of consistency** — one test of one property, held in the registry (§4). It runs and either **passes** or **raises a finding**. It has a **life** (§7): drafted → ratified → superseded/retired, all at the floor.

**An *item* is the atom of work** (§10) — a tracked unit with `status`, `rank`, `type`, and optionally an `epic`.

**The loop is the conversion**, and the conversion *is* the product:

```
        knowledge store (lessons · decisions · dossiers)
                    │                         ▲
        (forward · continuous)        (backward · floor-gated, slow)
                    │                         │
  check ──raises──▶ finding ──intake──▶ item ──ships──▶ (optionally) drafts a check ──FLOOR──▶ registered check
    ▲                (SPEC 3 §7)        (SPEC 3)          (SPEC 2 mint)     (SPEC 2)                │
    └──────────────────────────────────────── check registry (this spec) ◀─────────────────────────┘
```

- **Forward edge — `check → finding → item(s)`.** *Continuous.* The watch engine runs checks (SPEC 3 §6); each pass raises zero findings, each failure raises a `Finding`; intake turns findings into zero/one/many items (SPEC 3 §7). A finding is an *observation*, not itself work.
- **Backward edge — `item → check`.** *Deliberate, floor-gated, rare.* On ship, an item may mint a candidate check (SPEC 2 §mint) or curate an obsolete guard (SPEC 2 §curate). The asymmetry — fast forward, slow backward — is a feature: it keeps minted enforcement considered and human-ratified (honoring VISION REVIEW A2).

**The `Finding` — the currency of the forward edge** (defined here because SPEC 3's intake consumes it):

```ts
interface Finding {
  id: FindingId;         // stable within a watch pass; assigned at raise, carried into an item's provenance (§10)
  check: CheckId;        // which registered check raised it
  kind: FindingKind;     // inherited from check.kind — one of the four kinds (§5)
  scope: string[];       // where: the resolved paths/dossiers implicated
  detail: string;        // human-readable statement of the broken property
  evidence?: string;     // captured evaluator output (the "exit 0 ≠ pass" receipt)
  raised_at: string;     // ISO-8601
}
```

Neither atom is subordinate; the Runtime's identity is the cycle. This spec owns the **check** atom, the **Finding** currency, and the **item** atom's *schema* (§10) — SPECs 2 and 3 own the *edges*.

---

## 4. The check entry schema

A check is a single git-native YAML file (`<check-id>.yaml`), validated by a zod schema that is the ring-1 source of truth. **Types first (the frozen contract), then a full worked entry.**

```ts
// runtime/engine/schema/check.schema.ts — ring-1, project-agnostic

type CheckId   = string;   // kebab-case, globally unique, STABLE across code renames (never reuse an id)
type FindingId = string;   // identifies a raised Finding (§3); stable within a watch pass, carried into item provenance
type FindingKind = 'drift' | 'inconsistency' | 'gap' | 'staleness';        // §5
type CostTier    = 'cheap' | 'moderate' | 'expensive';                     // drives the DEFAULT context
type Context     = 'gate' | 'audit' | 'invariant';                         // §6
type CheckStatus = 'candidate' | 'active' | 'superseded' | 'retired';      // §7
type EvaluatorKind = 'deterministic' | 'judgment';                         // resolveEvaluator().kind (§11), frozen enum

interface DeterministicEvaluator {
  type: 'deterministic';
  run: string;            // a scheme-prefixed runnable ref — see the run-grammar dispatch table below
                          //   (e.g. "cmd:node tools/check-read-model-drift.mjs", "module:backlog-lint#ruleIdMatchesFilename")
  fix?: string;           // optional idempotent auto-fix command (always a plain subprocess, e.g. "node lint.mjs --fix")
}
interface JudgmentEvaluator {
  type: 'judgment';
  run: string;            // a scheme-prefixed judge/skill invocation (e.g. "skill:audit-integration-test")
                          //   flake_contract is REQUIRED at the check top-level when type==='judgment'
}
type Evaluator = DeterministicEvaluator | JudgmentEvaluator;

interface Scope {
  paths: string[];        // globs the check reads/guards — feeds scoped wake, audit scoping,
                          //   AND the dangling-scope rot-detector (§8): globs matching nothing ⇒ staleness
  dossiers?: string[];    // knowledge-store files this check binds the code against (staleness/inconsistency)
  exclusions?: string;    // optional path to a JSON exclusion/registry sidecar (the reusable gate pattern)
}

interface FlakeContract {         // REQUIRED iff evaluator.type === 'judgment'
  eval_scenario: string;          // path to the harness scenario that guards this check (SPEC 2 §eval)
  allowed_flake_rate: number;     // 0..1 budget; a judgment check exceeding it is itself a finding
  calibration: string;            // how the pass threshold was set (e.g. "n=20 runs, gatePassRate ≥ 0.95")
  min_confidence?: number;        // optional judge-confidence floor below which the check abstains, not fails
}

interface Provenance {
  minted_by: string;              // the ITEM id / lesson id whose ship minted this check; or "starter-pack" for seeded starter checks (SPEC 3 §13)
  lesson?: string;                // knowledge-store lesson path carrying the reciprocal `mints:` pointer
  ratified?: string;              // OPTIONAL: ISO date of the floor ratification, set on candidate→active.
                                  //   A candidate carries minted_by/lesson but NO ratified yet (§7).
  supersedes?: CheckId;           // the check this one replaced (set on a superseding mint)
  superseded_by?: CheckId;        // set when THIS check is superseded (curate arm)
  retired_reason?: string;        // set on retire; the argued reason recorded at the floor
}

interface CheckEntry {
  id: CheckId;
  property: string;               // one sentence: the single consistency property asserted
  kind: FindingKind;              // the finding kind this check raises when it fails
  evaluator: Evaluator;           // deterministic (default) or judgment (must earn it — §9)
  cost_tier: CostTier;            // drives the DEFAULT context; `contexts` records the actual truth
  contexts: Context[];            // the subset of {gate,audit,invariant} this check ACTUALLY runs in (≥1)
  scope: Scope;
  status: CheckStatus;
  flake_contract?: FlakeContract; // present iff evaluator.type === 'judgment'
  provenance: Provenance;
}
```

**The `run` grammar — an explicit-scheme dispatch table (no bare paths).** `evaluator.run` is always `<scheme>:<target>` drawn from a **closed** scheme set; an unprefixed/bare string is a `loadRegistry` validation error, so `resolveEvaluator` (§11) never has to guess:

| Scheme | `run` shape | How `resolveEvaluator` dispatches it |
|---|---|---|
| `cmd:` | `cmd:<shell-command>` | spawns a subprocess; non-zero exit ⇒ `Finding[]`, stdout/stderr → `evidence` (e.g. `cmd:node tools/check-read-model-drift.mjs`, `cmd:scripts/verify-structure.sh`) |
| `module:` | `module:<module-specifier>#<export>` | dynamic-`import()`s the ESM module and calls the named export as the pure check core (e.g. `module:backlog-lint#ruleIdMatchesFilename`) |
| `eslint:` | `eslint:<rule-id>` | runs the single named eslint rule; violations ⇒ `Finding[]` (e.g. `eslint:@nx/enforce-module-boundaries`) |
| `skill:` | `skill:<skill-name>` | invokes a judgment skill through SPEC 3's judge capability — the only scheme whose `kind` is `judgment` (e.g. `skill:audit-integration-test`) |

The scheme is the sole disambiguator: `module:backlog-lint#…` is a module ref, `cmd:node …` a subprocess — a bare `node …` or a scheme-less `backlog-lint:…` is rejected at load, never silently treated as a command. `fix` needs no scheme (it is always a plain subprocess). An unknown scheme or an unresolvable target ⇒ `EvaluatorUnresolved` (meta-check assertion 2, §8).

**A full worked entry (deterministic, first content-ring — quarantined project example):**

```yaml
# runtime/content/checks/read-model-single-writer.yaml   (Nestfolio content ring, seam #2)
id: read-model-single-writer
property: >
  Every governed read-model row has exactly one writer: a command-owned P1 is guarded, a
  projection never accumulates, and no (service,typename) is written by both a command and an
  event-processor intent factory unless registered in ReadModelOwnership or the exclusion sidecar.
kind: inconsistency          # two sources of truth (command side + projection side) disagree
evaluator:
  type: deterministic
  run: "cmd:node tools/check-read-model-drift.mjs"
  # no fix: read-model conflicts are never auto-resolved — they file a finding for intake
cost_tier: moderate          # repo-wide scan of intent factories + *.fn.js writes
contexts: [audit]            # heavy/repo-wide ⇒ watch-engine audit, NOT a per-item gate (honesty rule §6)
scope:
  paths:
    - "services/**/src/read-model-ownership.ts"
    - "services/**/src/**/*.ts"
    - "services/**/src/graphql/js-function/**/*.fn.js"
  dossiers:
    - "docs/architecture/READ-MODEL-OWNERSHIP.md"
  exclusions: "tools/read-model-exclusions.json"
status: active
provenance:
  minted_by: "read-model-redesign-ws-d"
  lesson: "MEMORY/feedback_bff_is_read_model.md"
  ratified: "2026-07-01"
```

**A second worked entry (judgment — showing `flake_contract`):**

```yaml
# runtime/content/checks/integration-test-completeness.yaml   (Nestfolio content ring, seam #2)
id: integration-test-completeness
property: >
  A service's integration suite uses createTestContext + cleanup.runAll + OrphanReaper, seeds only
  via events/mutations (no DdbSeedFixture), mocks all externals, and covers each BFF mutation.
kind: gap                    # something required (coverage / a fixture convention) is missing
evaluator:
  type: judgment             # an agent sweep of grep-based checklist items — not yet a single script
  run: "skill:audit-integration-test"
cost_tier: expensive
contexts: [audit]            # scheduled / on-demand, never per-item
scope:
  paths: ["services/**/test/integration/**"]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/integration-test-completeness.scenario.mjs"
  allowed_flake_rate: 0.05
  calibration: "n=20 runs on a known-good + known-bad service pair; gatePassRate ≥ 0.95"
  min_confidence: 0.7
provenance:
  minted_by: "integration-test-audit-skill"
  lesson: "MEMORY/feedback_no_seeder_fixtures.md"
  ratified: "2026-07-01"
```

> **Note (deterministic-first, §9):** `integration-test-completeness` is a judgment check *today* only because its per-row checks are grep-based prose. It is a prime candidate to be *superseded* by a deterministic `tools/check-*.mjs` gate — which is exactly the lifecycle move §7 makes first-class.

---

## 5. The four finding kinds

A check raises exactly one kind of finding (declared in `kind`). The four are exhaustive over *consistency* properties; each has a precise definition and a grounded example.

| Kind | Definition | Grounded example (content ring) |
|---|---|---|
| **drift** | An invariant that *was* holding just broke — a continuously-true property is now false. | `no-appsync-literals` (`tools/check-no-appsync-literals.mjs`): a literal `amazonaws.com` URL appears in frontend source that had none. The Charter invariant broke. |
| **inconsistency** | Two sources of truth disagree with each other. | `read-model-single-writer` (§4): the `ReadModelOwnership` registry and the actual intent-factory writes disagree about who owns a row. |
| **gap** | Something *required* is missing — a test, a consumer, a doc, an owner, a field. | `active-out-of-scope` (`backlog-lint` rule 4): a `status: active` item is missing a non-empty `out_of_scope`. Required field absent. |
| **staleness** | A *derived* artifact lags the source it was generated from. | `card-drift` (`tools/check-service-card-drift.mjs`): a service `CLAUDE.md` card's machine-derived sections lag `service.stack.ts`. The render is stale vs its source. |

**Taxonomy honesty (flagged for the meta-check).** Two grounded surfaces do **not** map cleanly to a *consistency* kind, and the registry treats them explicitly rather than forcing a fit:

- A **forbidden-construct-present** gate (e.g. `no-appsync-literals`, or a future `no-ddb-scan`) guards a continuously-true "this construct never appears" invariant → its violation **is `drift`** (the invariant broke). This is the correct mapping for the presence-of-forbidden-construct family.
- A **metric-threshold advisory** (pre-commit check #7: "staged change affects ≤5 projects") is **not** a consistency property at all — it is a stored knob (a threshold) plus a measurement, and `informational` is **not** one of the four `FindingKind`s. So a pure advisory is **not modeled as a `CheckEntry` row at all** — every `CheckEntry` must declare one of the four kinds, and an advisory has none. What the registry *does* model is decision 3's obligation: the threshold `5` is a stored knob that must itself be the `scope` of an `active` check, and the meta-check's rot-detector ii (§8) files a `gap` finding when it is not. The advisory measurement stays a plain script output *outside* the registry; only the knob-has-a-validating-check obligation enters it.

`FindingKind = 'drift' | 'inconsistency' | 'gap' | 'staleness'` is the frozen enum SPECs 2/3 consume.

---

## 6. The three contexts

The same check definition can run in three contexts — but *whether* it does is a cost decision the registry records honestly.

| Context | When it runs | What it is | Default `cost_tier` |
|---|---|---|---|
| **gate** | at an item boundary — item **start** or **ship** | a hard check that must pass before work proceeds | `cheap` |
| **audit** | on a trigger/schedule — manual · scheduled · on-commit/merge/CI — over a **scope** | a runnable sweep that emits findings | `moderate` / `expensive` |
| **invariant** | continuously asserted | an always-true property of the whole codebase | `cheap` (**cheap-by-construction**) |

**The honesty rule (load-bearing — non-negotiable).** *"One check, three contexts" is a property of the **library**, not usually of a single check.* Cost forces most checks into *one* context — a cheap invariant runs as a gate; an expensive judgment runs as a scheduled audit. A check *may* span contexts and the registry allows a `contexts` array of length > 1, but **`contexts` records the truth** rather than pretending every check is omnipresent (VISION §6; VISION REVIEW A4). `cost_tier` sets the *default* context; `contexts` is the *actual* subset and is authoritative.

**Cheap-by-construction is a schema rule, not a hope (tension (b)).** An `invariant`-context check **must** be `cost_tier: cheap`. A globally-important-but-expensive property is modeled as an `audit`, **never** an `invariant`. This is what lets `findByScope` (§11) put *all* global invariants into every scoped wake without cost blowup: scoping narrows the *retrieval* surface (dossiers, expensive audits), and **never** the enforcement floor. The meta-check (§8) asserts `contexts.includes('invariant') ⇒ cost_tier === 'cheap'`.

`Context = 'gate' | 'audit' | 'invariant'` is the frozen enum.

---

## 7. The check lifecycle

A check is **not immortal.** Its `status` moves through a small state machine, and **every state-advancing transition happens at the floor** — this is what makes enforcement *curated, not hoarded* (tension **(a)**).

```
                    ┌─────────── edit (floor, re-draft) ───────────┐
                    ▼                                              │
   (draft) ───▶ candidate ──ratify (floor)──▶ active ──retire (floor)──▶ retired  (terminal)
                    │                            │
                 decline                      supersede (floor;
                 (floor)                      a successor is minted
                    │                         active in the same act)
                    ▼                            │
              (discarded —                       ▼
               NEVER registered)             superseded  (terminal)

   async, non-blocking:  active ──dangling-scope detected (meta-check §8)──▶ files a STALENESS finding
                         (a "retirement candidate" — routed to an item; state advances ONLY at the floor)
```

**Transition table:**

| From | Trigger | Guard | To | Who |
|---|---|---|---|---|
| *(draft)* | `mint` | evaluator resolves; if judgment ⇒ `flake_contract` present | `candidate` | worker (drafts) |
| `candidate` | `ratify` | floor approval; `resolveEvaluator` succeeds; judgment ⇒ eval scenario exists | `active` | **floor (human)** |
| `candidate` | `edit` | floor approval | `candidate` | **floor** |
| `candidate` | `decline` | floor approval | **discarded** (no file persisted — only ratified checks persist) | **floor** |
| `active` | `supersede` | floor approval; a successor check registered `active` in the same floor act; `supersedes`/`superseded_by` chained | `superseded` | **floor** |
| `active` | `retire` | floor approval; `retired_reason` recorded; lesson `mints:` reconciled | `retired` | **floor** |
| `active` | *dangling-scope detected* | meta-check finds `scope.paths` resolve to nothing | **stays `active`**, files a `staleness` finding (retirement candidate) | watch engine (async) |
| `superseded` / `retired` | — | terminal | — | — |

**Rules the machine enforces:**

- **A candidate on `decline` is discarded, never registered.** Only ratified checks persist as files (VISION §6). A candidate is a transient draft held by the worker until the floor rules.
- **Retiring is as deliberate as creating.** You must *choose* to lower a guard at the floor; on `keep` (the default) the failure stands and the code must satisfy the check (VISION §9). This is the mechanized answer to VISION REVIEW A1 — the retirement path the "monotonic" headline needs.
- **The meta-check never advances state.** It only *files a finding* (a retirement candidate); the actual `active → retired` move waits for the floor, routed through intake like any other work (VISION §9 async arm).
- **Nothing is silently deleted.** `superseded`/`retired` are terminal *states*, not deletions; the `supersedes` chain keeps enforcement history legible (`status` + provenance = "what the project still intends", not "everything ever minted").

The mint and curate *procedures* (who drafts, how the floor presents, how the lesson `mints:` pointer is reconciled) are **SPEC 2**. This spec owns only the `status` field, the state set, and the `advanceLifecycle` helper (§11).

`CheckStatus = 'candidate' | 'active' | 'superseded' | 'retired'` is the frozen enum.

---

## 8. The meta-check (the registry self-check)

The registry is new state — so the obvious objection is *"won't the registry itself drift, and won't minted checks pile up forever?"* The answer is a **meta-check**: a check whose `scope` is the registry itself. Because a check *runs*, a stale or unrunnable registry entry **fails loudly** — unlike a stored note, it cannot silently rot.

**Three integrity assertions (drift/inconsistency/gap):**

1. **Every enforced surface ↔ a registry entry.** Every enforced surface **enumerated by the injected `env` (§11)** — nx targets, lint rules, pre-commit lines, skills in the *host* project, none named by ring-1 itself — must resolve to exactly one `active` `CheckEntry`. An enforced surface with **no** entry → an `inconsistency` finding (two sources of enforcement disagree). *(This is the assertion that would have caught `check-typed-fixtures.mjs` having no nx target and `card-drift`/`check-service-card-drift.mjs` name skew.)*
2. **Every entry ↔ a runnable evaluator.** `resolveEvaluator(check)` must succeed — the `run` command/module must exist and be invokable. An entry pointing at a missing evaluator → a `gap` finding.
3. **Every judgment check has its guard.** `evaluator.type === 'judgment' ⇒ flake_contract` present **and** `flake_contract.eval_scenario` resolves to a real harness scenario. Missing → a `gap` finding. *(This is what makes "judgment earns the word check", §9, machine-enforced.)*

**Two rot-detectors (this is the answer to "won't checks pile up?"):**

- **(i) Dangling scope → retirement candidate.** A check whose `scope.paths` globs resolve to **zero files** guards code that is gone → a `staleness` finding, filed as a *retirement candidate* (routed to an item; the floor decides retire/keep, §7). This is the mechanism that keeps the library from accreting stale-but-green guards (VISION §6, closing VISION REVIEW A1's carrying-cost worry).
- **(ii) Stored knob with no validating check → a finding.** Any stored knob — a `rank` weight, a lane threshold, the blast-radius `5`, the floor's sensitivity — that is not itself the `scope` of an `active` check is a `gap` finding. This binds VISION law §13.2 ("any stored knob is itself a checked property") into the meta-check, and it is the same move that absorbs the configuration-drift worry (SPEC REVIEW A2, the `severity` scar).

**Cheap-by-construction assertion** (from §6): `contexts.includes('invariant') ⇒ cost_tier === 'cheap'`, else an `inconsistency` finding — so an expensive property can never masquerade as an always-on invariant and silently blow up the scoped wake.

The meta-check is itself a registered check (`id: registry-integrity`, `contexts: [audit]`, `cost_tier: moderate`) — its assertion-1 gather is a whole-repo inventory of enforced surfaces (via the injected `env`, §11) plus glob resolution, so it is an `audit` sweep on a trigger/schedule, **not** a per-item `gate` (consistent with the tiering that makes the comparable repo-wide `read-model-single-writer` scan `moderate`, §4). The registry is not exempt from its own discipline.

---

## 9. Deterministic-first, and how a judgment check earns the word "check"

**Deterministic-first is the registry's standing preference** (VISION §13.3): if a property *can* be a script, it **is** one — `evaluator.type: 'deterministic'`. Judgment is the fallback, and it is a *guarded* fallback. This is also the mechanism behind **enforcement-as-memory being the *checkable subset*** (tension **(c)**): of the ~58 `feedback_*` lessons, only the ~15-20 mechanizable ones become checks; the rest stay retrieval in the knowledge store. The registry never claims enforcement *replaces* reminding — it is the executable subset alongside recall (SPEC 3 §knowledge-store owns the retrieval half).

**A judgment check earns the word "check" by carrying two schema obligations** (the full mechanics — calibration procedure, how the eval scenario is authored, how flake is regressed — belong to **SPEC 2 §eval** and **SPEC 3 §eval-harness**; only the *schema fields* are fixed here):

1. **`flake_contract`** — required when `evaluator.type === 'judgment'` (§4). It declares `allowed_flake_rate`, `calibration`, and an optional `min_confidence` abstain floor. A judgment check whose measured flake exceeds its budget is *itself a finding* (the meta-check regresses it via its eval scenario).
2. **`flake_contract.eval_scenario`** — a pointer to a harness scenario that guards the check. The meta-check assertion 3 (§8) refuses to let a judgment check be `active` without it.

**Deterministic-first is enforced by lifecycle, not just preference.** When a judgment check's property later becomes mechanizable (e.g. `integration-test-completeness` → a `tools/check-*.mjs` gate), the deterministic successor is *minted*, and the judgment predecessor is *superseded* at the floor (§7) — the `supersedes` chain records the upgrade. The registry actively drives judgment → deterministic over time.

Honoring tension **(e)**: judgment checks are non-deterministic and the registry **says so** in the data model. `evaluator ∈ { deterministic, judgment }` and `cost_tier ∈ { cheap, moderate, expensive }` are frozen enums.

---

## 10. The item schema

The item is the atom of *work*. Ring-1 keeps it **abstract**; the project seam binds it to the host's real work-tracking format. Nestfolio's `docs/backlog/*.md` frontmatter is the **first content-ring binding**.

**Abstract core (ring-1, project-agnostic):**

```ts
// runtime/engine/schema/item.schema.ts — ring-1

type ItemId = string;
type ItemStatus = string;   // lifecycle-open set (project binds the values); e.g. active|queued|parking|shipped|dropped
type ItemType   = string;   // project binds; e.g. bug|design|spec|epic|feature

interface Item {
  id: ItemId;
  type: ItemType;
  status: ItemStatus;
  rank?: number;              // the ONLY stored priority input (law 2); everything else is read-time derived
  epic?: ItemId;              // single-parent pointer (1-level tree)
  epic_role?: 'core' | 'captured';
  done_criteria: string;      // the closure predicate ("done_when" in the backlog binding)
  scope?: string;             // path-glob-shaped: what the item's diff may touch (a glob, or a newline/space-
                              //   separated glob set) — feeds the scope-gate check (SPEC 3, tension (d)) AND
                              //   findByScope's overlap predicate (§11). NOT free prose.
  out_of_scope?: string[];    // the explicit non-goals surface (required when status is active)
  references?: string[];      // reference paths/anchors this item's spec/design cites
  provenance?: {              // the forward-edge link: which finding/check spawned this item
    from_finding?: FindingId; // the Finding.id (§3) that intake turned into this item — NOT a CheckId
    from_check?: CheckId;     // the registered check that ultimately raised it (denormalized for query)
  };
}
```

**First content-ring binding — Nestfolio backlog frontmatter (seam #2, quarantined):**

| Abstract core field | Backlog frontmatter field | Notes |
|---|---|---|
| `id` | `id` | rule 1: matches filename |
| `type` | `type` | `∈ {bug, design, spec, epic, feature, …}` |
| `status` | `status` | `∈ {active, queued, parking, shipped, dropped}` |
| `rank` | `rank` | only for `status: queued` (rule 6: set + unique) |
| `epic` | `epic` | member pointer (rule 10) |
| `epic_role` | `epic_role` | `∈ {core, captured}` |
| `done_criteria` | `done_when` | required for active epics (rule 4b) |
| `scope` | `scope` | required for active epics |
| `out_of_scope` | `out_of_scope` | required when active (rule 4a) |
| `references` | `references` | rule 3: paths + anchors resolve (structural) |
| — | `spec`, `plan`, `topic_memory`, `validation_gate`, `notes`, `closed`, `requires_deploy` | project-local extensions; ring-1 ignores them |
| `provenance.from_finding` | *(new)* | the backward→forward link the registry adds |

The 11 backlog invariants become **11 content-ring `CheckEntry` files** in the `invariant`/`gate` contexts (§12) — so the item schema and its lint are *just more checks in the registry*. This is exactly the equivalence-map "generalized" row (TARGET-ARCH §11: "`backlog-lint` 11 invariants → 11 entries in the check registry").

Frozen item-schema field names: `id, type, status, rank, epic, epic_role, done_criteria, scope, out_of_scope, references, provenance`.

---

## 11. Ring-1 realization — file layout & typed helpers

**Git-native layout.** Ring 1 (the engine) is project- and harness-agnostic and depends outward on nothing. Rings 2–3 are swappable content.

```
runtime/
  runtime.config.json                  # { checksDir, exclusionsRoot } — the ONLY project binding, deliberately
                                       #   OUTSIDE engine/ so ring-1 owns no project-specific file (seam #2)
  engine/                              # RING 1 — pure, project- & harness-agnostic
    schema/
      check.schema.ts                  # CheckEntry + zod validator (source of truth, §4)
      item.schema.ts                   # Item + zod validator (§10)
      finding.schema.ts                # Finding (§3)
    lib/
      load-registry.mjs                # loadRegistry()
      resolve-evaluator.mjs            # resolveEvaluator()
      run-check.mjs                    # runCheck()
      meta-check.mjs                   # metaCheck()  (§8)
      find-by-scope.mjs                # findByScope() (scoped wake, §6/§11)
      advance-lifecycle.mjs            # advanceLifecycle() (§7)
    test/
      *.test.mjs                       # node --test, import pure cores directly
  content/                             # RING 3 — the PROJECT SEAM (Nestfolio's first check library)
    checks/
      <check-id>.yaml                  # one file per check (§4, §12)
    exclusions/                        # the reusable pure-fn + JSON-sidecar gate pattern
      read-model-exclusions.json       # (relocated from tools/ — or referenced in place)
  eval/
    scenarios/*.scenario.mjs           # judgment-check eval scenarios (SPEC 2 owns authoring)
```

The engine reads `runtime.config.json` (a sibling of `engine/`, never a file *inside* ring 1) for *where* checks live — it never hard-codes `runtime/content/`, and every helper takes `checksDir`/`exclusionsRoot` as **pure arguments**, so ring-1 owns no project-specific file. That single indirection is seam #2: point `checksDir` at another repo's check library and ring-1 is unchanged.

**Typed helper signatures** (house convention: `#!/usr/bin/env node`, JSDoc header, pure named-export core + thin `main()`, no default exports, tests import the pure fn directly; run via `node --test runtime/engine/test/*.test.mjs`):

- **`loadRegistry({ checksDir }) → { checks, byId, errors }`**
  - **Pure core:** parse + zod-validate every `*.yaml` under `checksDir`. Malformed files are reported **located-by-filename** in `errors[]` (never crash the run — mirrors `backlog-lint`'s parseable precondition). `byId` is a `Map<CheckId, CheckEntry>`.
  - **CLI:** `load-registry.mjs [--checks-dir]` — prints a summary; **exit 0** clean, **1** any malformed/duplicate-id, **2** usage.
  - **Pins:** duplicate `id` across two files → error (ids are globally unique); a malformed YAML → a located error, not a `SyntaxError`.

- **`resolveEvaluator({ check }) → { kind, invoke }`** where `kind ∈ EvaluatorKind` (`deterministic | judgment`)
  - **Pure core:** parses `evaluator.run` against the **run-grammar dispatch table (§4)** — `cmd:` → subprocess runner, `module:<spec>#<export>` → dynamic-`import()`ed pure fn, `eslint:<rule>` → single-rule runner, `skill:<name>` → judge capability — and returns a thunk `invoke() → Finding[]` bound to that branch. For `judgment` (`skill:`), it also asserts `flake_contract` is present.
  - **Pins:** an unknown scheme, a bare/unprefixed `run`, or a target that does not resolve → throws a typed `EvaluatorUnresolved` (the meta-check assertion 2 surface); a judgment check missing `flake_contract` → `JudgmentContractMissing`; a clean `cmd:`/`module:`/`eslint:` resolve returns `kind: 'deterministic'`, a `skill:` resolve returns `kind: 'judgment'`.

- **`runCheck({ check, context }) → { findings, ran, skippedReason }`**
  - **Pure-ish core:** refuses when `context ∉ check.contexts` (`ran: false`, `skippedReason: 'context-not-declared'`) — a check never runs in a context it did not declare (the honesty rule, §6, is *enforced*, not documented). Otherwise resolves the evaluator, runs it, returns `Finding[]` tagged with `check.kind`.
  - **CLI:** `run-check.mjs <check-id> --context=<gate|audit|invariant>` — **exit 0** no findings, **1** findings raised (the "fails loudly" contract), **2** usage/refused-context.

- **`metaCheck({ registry, env }) → Finding[]`** (§8)
  - **The injected `env` (typed seam — keeps the core pure *and* project-agnostic):**
    ```ts
    interface MetaCheckEnv {
      enforcedSurfaces: { id: string; kind: 'nx-target' | 'lint-rule' | 'precommit' | 'skill' | string; run: string }[];
      resolveGlobs(paths: string[]): string[];          // glob → concrete files, for the dangling-scope rot-detector
      storedKnobs: { id: string; scopeRef?: string }[]; // the derive-don't-store inventory (VISION §13.2)
    }
    ```
    The harness supplies `env`; ring-1 never enumerates surfaces itself — surface *types* live behind `enforcedSurfaces[].kind`, not in the core (the seam that keeps assertion 1 project-agnostic).
  - **Pure core:** runs the three integrity assertions + two rot-detectors + the cheap-by-construction assertion over `registry` and `env` — **injected**, so the core is pure and testable.
  - **CLI:** `meta-check.mjs` — **exit 0** clean registry, **1** any integrity/rot finding, **2** usage. This is the check `registry-integrity` itself.

- **`findByScope({ registry, scope }) → { checks, invariants }`** (scoped wake, §6)
  - **The overlap predicate (defined, not hand-waved):** the item `scope` is resolved to a **path/glob set** (§10 requires `Item.scope` be path-glob-shaped, not free prose); a check *overlaps* the item **iff any glob in `check.scope.paths` intersects any path in the item's scope set** — i.e. there is a concrete path matched under both patterns. `check.scope.dossiers` do **not** participate in item-scope overlap (they bind code↔knowledge and are resolved by the watch engine, not the wake).
  - **Pure core:** `checks` = every `active` check whose `scope.paths` overlaps the item scope set by that predicate (retrieval-scoped). `invariants` = **every** `active` check with `contexts.includes('invariant')` — **always returned in full, regardless of scope** (tension **(b)**: global invariant gates always ride the wake). The union is the wake payload's enforcement floor.
  - **Pins:** a check whose `scope.paths` only *partially* overlaps the item scope (one glob in common, others disjoint) **is** returned; a global invariant is returned even when its `scope` does not overlap the item (scoping narrows retrieval, never enforcement); an expensive check outside scope is *not* returned (deferred to the watch engine).

- **`advanceLifecycle({ check, transition, floorApproval, successor }) → { check, event }`** (§7)
  - **Pure core:** `transition ∈ { ratify, edit, decline, supersede, retire }`. The safety law: **every transition requires `floorApproval === true`** — with `floorApproval` false it returns `{ check: unchanged, event: 'REFUSED_NO_FLOOR' }`. **Guard precedence is fixed:** the floor-approval guard is evaluated **first**, before the from-state legality guard — so a floorless *illegal* transition returns `REFUSED_NO_FLOOR` (never `REFUSED_ILLEGAL_TRANSITION`), making the two refusals deterministic. `decline` on a `candidate` (floor present) returns `{ check: null, event: 'DISCARDED' }` (discard — never persisted). `supersede` requires a `successor` check and writes the `supersedes`/`superseded_by` chain on both. Valid `from`-states are guarded per the transition table (§7); an illegal transition *with the floor present* (e.g. `ratify` on an already-`active` check) returns `REFUSED_ILLEGAL_TRANSITION`.
  - **CLI:** `advance-lifecycle.mjs <check-id> --transition=<t>` — driven only by the floor procedure (SPEC 2); **exit 0** applied, **1** refused, **2** usage.

The helpers are the *whole* engine — no external service. This is the "git-native files plus small, tested helpers" ring-1 the vision names (VISION §12).

---

## 12. First content-ring entries (quarantined project-seam examples)

The 34 grounded surfaces map onto `CheckEntry` fields as the first content ring. **This table is Nestfolio content behind seam #2 — it is *not* part of ring-1.** A representative slice (the full 34 are one YAML file each under `runtime/content/checks/`):

| Registry `id` | Source surface | `kind` | `evaluator` | `cost_tier` | `contexts` | `evaluator.run` |
|---|---|---|---|---|---|---|
| `backlog-id-matches-filename` | lint rule 1 | inconsistency | deterministic | cheap | `[invariant, gate]` | `module:backlog-lint#ruleIdMatchesFilename` |
| `backlog-single-active-nonepic` | lint rule 2 | inconsistency | deterministic | cheap | `[invariant]` | `module:backlog-lint#ruleSingleActive` |
| `backlog-references-valid` | lint rule 3 | staleness | deterministic | cheap | `[gate]` | `module:backlog-lint#ruleReferencesValid` |
| `backlog-active-out-of-scope` | lint rule 4a | gap | deterministic | cheap | `[gate]` | `module:backlog-lint#ruleActiveOutOfScope` |
| `backlog-index-matches` | lint rule 7 | drift | deterministic | cheap | `[gate]` (has `fix`) | `module:backlog-lint#ruleIndexMatches` (`fix: lint.mjs --fix`) |
| `read-model-single-writer` | `read-model-drift` nx target | inconsistency | deterministic | moderate | `[audit]` | `cmd:node tools/check-read-model-drift.mjs` |
| `service-card-fresh` | `card-drift` nx target + precommit #10 | staleness | deterministic | moderate | `[gate, audit]` (has `fix`) | `cmd:node tools/check-service-card-drift.mjs` |
| `typed-subject-conventions` | `typed-subject-drift` + precommit #8 | inconsistency | deterministic | cheap | `[invariant, gate]` | `cmd:node tools/check-typed-subjects.mjs` |
| `typed-fixture-regression` | precommit #9 (**no nx target** today) | drift | deterministic | cheap | `[gate]` | `cmd:node tools/check-typed-fixtures.mjs` |
| `no-appsync-literals` | `check-charter-invariants` (lint dependsOn) | drift | deterministic | cheap | `[invariant, gate]` | `cmd:node tools/check-no-appsync-literals.mjs` |
| `module-boundaries` | eslint `enforce-module-boundaries` | inconsistency | deterministic | cheap | `[gate]` | `eslint:@nx/enforce-module-boundaries` |
| `service-structure` | precommit #1-#5 | gap | deterministic | cheap | `[gate]` | `cmd:scripts/verify-structure.sh` |
| `service-card-complete` | `audit-service` skill | staleness | **judgment** | expensive | `[audit]` | `skill:audit-service` (+ `flake_contract`) |
| `domain-consistency` | `audit-domain` skill | inconsistency | **judgment** | expensive | `[audit]` | `skill:audit-domain` (+ `flake_contract`) |
| `integration-test-completeness` | `audit-integration-test` skill | gap | **judgment** | expensive | `[audit]` | `skill:audit-integration-test` (+ `flake_contract`) |
| `semantic-reference-fresh` | lint's "drift it cannot catch" | staleness | **judgment** | expensive | `[audit]` | `skill:boundary-review` (+ `flake_contract`) |

**What this table demonstrates for ring-1:**

- **The reusable gate pattern is real and undocumented today.** All 5 `tools/check-*.mjs` gates already share one shape — *pure-function tool + JSON exclusion sidecar + `node:test` tmpdir tests + optional `--fix` + optional nx target + optional pre-commit line*. `check-service-card-drift.mjs`'s own header says it "mirrors `tools/check-read-model-drift.mjs`." The registry **formalizes that de-facto template** as `Scope.exclusions` + `Evaluator` + `contexts`. This is the single biggest reuse win.
- **The wiring inconsistencies become findings, not surprises.** `typed-fixture-regression` having no nx target, and `service-card-fresh`/`card-drift` name skew, are exactly what meta-check assertion 1 (§8) files.
- **The judgment→deterministic upgrade path is visible.** The 5 `audit-*` skills are `judgment` today; `audit-integration-test`/`audit-e2e-test` are near-deterministic grep checklists and are marked as supersession candidates (§9).
- **Trigger/cadence is *not* a `CheckEntry` field.** `CheckEntry` (§4) carries no `onTrigger`/cadence — *when* a check fires is **derived** from `cost_tier` (cheap ⇒ per-boundary gate/invariant; moderate/expensive ⇒ scheduled/on-commit/merge/CI audit) and is owned by SPEC 3's watch engine and its `onTrigger` capability interface. The equivalence-map "pre-commit hooks → registry entries" row (TARGET-ARCH §11) is about *what* is enforced, not a per-check commit-trigger field. A genuine per-check trigger override would have to come *back* to the frozen schema (§15) — it is deliberately absent here.

---

## 13. Validation strategy (TDD scenarios)

Ring-1 is pure helpers + schema — so validation is **deterministic `node --test`** at the golden-gate layer (no live e2e; judgment-check *flake* validation is SPEC 2's eval harness). Distinguish: this spec's teeth are the golden gates below; the judgment layer is guarded by the flake_contract mechanics deferred to SPEC 2.

Each scenario is `given / when / then`; assertions pin **outcomes and named guarantees**, positive **and** negative.

**A. `loadRegistry` (loader) ×5**

1. *given* a `checksDir` with 3 valid YAML checks · *when* `loadRegistry` · *then* `checks.length === 3`, `byId` has all 3, `errors === []`.
2. *given* one file with malformed YAML · *when* load · *then* it appears in `errors[]` **located by filename**, the other checks still load, **no throw**. (Pins: parseable-precondition parity with `backlog-lint`.)
3. *given* two files declaring the same `id` · *when* load · *then* a duplicate-id error (ids globally unique).
4. *given* a check missing a required field (`property`) · *when* load · *then* a zod-validation error naming the file + field.
5. *given* a judgment check with **no** `flake_contract` · *when* load · *then* a validation error (schema refuses judgment-without-contract).

**B. `metaCheck` (registry self-check) ×6**

1. *given* an enforced nx target with no registry entry · *when* metaCheck · *then* one `inconsistency` finding naming the orphaned target (assertion 1).
2. *given* an entry whose `evaluator.run` does not resolve · *when* metaCheck · *then* one `gap` finding (assertion 2). *And*: an entry whose evaluator **does** resolve raises **no** finding (negative).
3. *given* a judgment check with `flake_contract` but a **non-existent** `eval_scenario` path · *when* metaCheck · *then* one `gap` finding (assertion 3).
4. *given* an `active` check whose `scope.paths` glob matches **zero** files · *when* metaCheck · *then* one `staleness` finding tagged *retirement-candidate* — and the check's `status` **remains `active`** (rot-detector i; meta-check never advances state).
5. *given* a stored knob (a `rank` weight) that is not the `scope` of any `active` check · *when* metaCheck · *then* one `gap` finding (rot-detector ii; binds law §13.2).
6. *given* a check with `contexts: [invariant]` and `cost_tier: expensive` · *when* metaCheck · *then* one `inconsistency` finding (cheap-by-construction).

**C. `advanceLifecycle` (transitions) ×7**

1. *given* a `candidate` + `floorApproval: true` + `transition: ratify` · *when* advance · *then* `status: active`, `provenance.ratified` set; `event: 'RATIFIED'`.
2. *given* a `candidate` + `floorApproval: false` + `ratify` · *when* advance · *then* **unchanged**, `event: 'REFUSED_NO_FLOOR'` (the floor guard bites — negative).
3. *given* a `candidate` + `floorApproval: true` + `transition: decline` · *when* advance · *then* `check: null`, `event: 'DISCARDED'` (discarded, never persisted).
4. *given* an `active` + `transition: supersede` + a `successor` · *when* advance · *then* `status: superseded`, `superseded_by` = successor id, successor's `supersedes` = this id (chain both sides).
5. *given* an `active` + `transition: retire` + `floorApproval: true` · *when* advance · *then* `status: retired`, `retired_reason` recorded (nothing deleted — terminal state).
6. *given* an already-`active` + `floorApproval: true` + `transition: ratify` · *when* advance · *then* `event: 'REFUSED_ILLEGAL_TRANSITION'` (with the floor present, the from-state guard is what bites — the precedence rule, §11).
7. *given* an already-`active` + `floorApproval: false` + `transition: ratify` (floorless **and** illegal) · *when* advance · *then* `event: 'REFUSED_NO_FLOOR'` (floor-guard precedence — the floor check bites first, never `REFUSED_ILLEGAL_TRANSITION`).

**D. `findByScope` (scoped wake) ×4**

1. *given* an item scope overlapping 2 checks + 4 global invariants elsewhere · *when* findByScope · *then* `checks` = the 2 overlapping, `invariants` = **all 4** (global invariants always ride the wake — tension (b) positive).
2. *given* an expensive `audit` check outside the item scope · *when* findByScope · *then* it is **not** returned (retrieval-scoped — negative).
3. *given* a global `invariant` whose `scope` does **not** overlap the item · *when* findByScope · *then* it **is** returned (scoping narrows retrieval, never enforcement).
4. *given* an item whose scope globs **partially** overlap one check's `scope.paths` (one glob in common, the rest disjoint) · *when* findByScope · *then* that check **is** in `checks` (the §11 overlap predicate: any item path intersecting any `scope.paths` glob).

**E. `runCheck` (context enforcement + finding tagging) ×4**

1. *given* a check with `contexts: [audit]` invoked with `context: 'gate'` · *when* runCheck · *then* `{ ran: false, skippedReason: 'context-not-declared' }`, zero findings (the honesty rule is *enforced*, §6 — negative).
2. *given* the same check invoked with `context: 'audit'` (a declared context) · *when* runCheck · *then* `ran: true`, the evaluator resolves and runs (positive — the counterpart to E1).
3. *given* a declared-context run whose evaluator raises · *when* runCheck · *then* every returned `Finding` is tagged `kind === check.kind`, and the CLI exits **1** (the "fails loudly" contract).
4. *given* a declared-context run whose evaluator passes · *when* runCheck · *then* `findings === []`, `ran: true`, CLI exits **0**.

**F. `resolveEvaluator` (run-grammar dispatch + guards) ×4**

1. *given* a deterministic check `run: "cmd:node tools/check-x.mjs"` that resolves · *when* resolveEvaluator · *then* `{ kind: 'deterministic', invoke }` and `invoke` is a callable thunk (positive — meta-check assertion 2's clean surface).
2. *given* a check whose `run` has an unknown scheme, is bare/unprefixed, or points at a non-existent target · *when* resolveEvaluator · *then* it throws `EvaluatorUnresolved` (assertion 2's failure surface — negative).
3. *given* a judgment check (`skill:…`) with **no** `flake_contract` · *when* resolveEvaluator · *then* it throws `JudgmentContractMissing` (assertion 3's failure surface).
4. *given* one check per scheme (`cmd:`/`module:`/`eslint:`/`skill:`) · *when* resolveEvaluator · *then* each resolves via its dispatch-table branch, with `kind: 'deterministic'` for the first three and `kind: 'judgment'` for `skill:` (grammar coverage).

Run: `node --test runtime/engine/test/*.test.mjs`. All golden gates deterministic; distinct from the live/judgment coverage SPEC 2 adds.

---

## 14. Scope

**In scope (this spec):** the `CheckEntry` schema + zod validator; the `Finding` and `Item` schemas; the four finding kinds; the three contexts + honesty rule; the check lifecycle state machine + `status` enum; the meta-check integrity + rot assertions; the ring-1 file layout and the six typed helper signatures with TDD scenarios; the first-content-ring *mapping table* (as quarantined example, not implementation).

**Out of scope (owned elsewhere):**

- **The backward edge — mint/curate procedures, the floor presentation, lesson `mints:` reconciliation, the eval-harness home for minted scenarios, minting-vs-judgment *heuristics*.** → **SPEC 2**. This spec fixes only the `status` field, `provenance` shape, and `advanceLifecycle` signature the floor drives.
- **The forward edge — watch engine, intake router, planner/read-time impact, worker/orchestrator execution, the six capability interfaces, the `journal` contract, the `<<HARNESS-PAUSE>>` sentinel, the equivalence map.** → **SPEC 3**. This spec fixes only the `Finding` shape intake consumes and `findByScope`.
- **The scope-gate check *mechanics*** (diff ⊆ declared scope; how it bites at commit + ship — tension (d)). → **SPEC 3**. This spec only asserts it *is* a registry entry (a `gate`/`invariant` check over the item's `scope` field).
- **Judgment/flake *mechanics*** (calibration procedure, how eval scenarios are authored/regressed). → **SPEC 2**. This spec fixes only the `flake_contract` *fields*.
- **Migrating the 34 live surfaces into YAML files** and physically relocating `tools/*-exclusions.json`. That is realization/implementation, not this design.
- **The starter check library + cold-start on-ramp** (VISION §15.5) and the **operational/rendering surface** (VISION §15.6).
- **Product name.**

---

## 15. Build sequence / dependencies

This spec is **foundational** — SPECs 2 and 3 depend on its schema verbatim. Build order:

1. **SPEC 1 (this) — the schema & ring-1 helpers.** `check.schema.ts` + `item.schema.ts` + `finding.schema.ts`, then `loadRegistry` / `resolveEvaluator` / `runCheck` / `metaCheck` / `findByScope` / `advanceLifecycle` with their §13 TDD gates. Nothing downstream can typecheck until the frozen contract (below) exists. **No project content is migrated here** — ring-1 only.
2. **SPEC 2 — the backward edge (the moat), proven FIRST on real lessons.** Consumes `status`, `provenance`, `FlakeContract`, and `advanceLifecycle`. Per SPEC REVIEW's "the moat is the unbuilt backward edge," SPEC 2 dogfoods the `lesson → candidate check → floor-ratify → registered → eval scenario` path end-to-end on ~5 real mechanizable `feedback_*` lessons (the grounding names five: `no_scan_no_filter`, `no_silent_fallback_in_agent_results`, `no_seeder_fixtures`, `prefer_libraries_over_casts`, `states_runtime_uncatchable`) before generalizing.
3. **SPEC 3 — the forward edge & capability seams.** Consumes `Finding`, `findByScope`, and the `Context` enum; binds the six capability interfaces; carries the no-lost-value equivalence map that migrates the 34 surfaces into content-ring YAML.

**Dependency rule:** ring-1 (this spec) **never depends outward** — not on any harness (SPEC 3's seam #1) and not on any project content (the §12 table, seam #2). If a downstream spec needs a schema change, it comes *back* here and re-freezes the contract; downstream specs pin the frozen block below and must not re-shape it unilaterally.

**Re-freeze deltas (this finalization — SPECs 2 & 3 consume verbatim).** Three deltas versus the first-cut frozen block were re-frozen here; each is backward-edge/forward-edge load-bearing, so the reciprocal update is called out for the consuming specs:

1. **`Provenance.ratified` is now OPTIONAL** (`ratified?: string`) — a `candidate` carries `minted_by`/`lesson` but **no** `ratified`; the date is populated on the `candidate→active` ratify transition (§4, §7). Without this, a valid `candidate` (the input `advanceLifecycle.ratify` must accept) was unrepresentable. **SPEC 2** (drives `advanceLifecycle`/provenance) pins the optional field.
2. **`Finding` gains `id: FindingId`** and **`Item.provenance.from_finding` is typed `FindingId`** (the raised-finding identifier), **not** `CheckId` (§3, §4, §10) — so `from_finding` (which finding) and `from_check` (which check ultimately raised it) are now distinct, and the forward-edge link has a real token to hold. **SPEC 3** (raises `Finding`s, runs intake) pins `Finding.id` and the `FindingId` provenance type.

3. **`Provenance.minted_by` reserves the value `"starter-pack"`** — seeded starter-library checks (SPEC 3 §13) have neither a minting item/lesson nor a per-check floor ratification, so they carry `minted_by: "starter-pack"` and ship **pre-ratified** (`ratified` = the starter-pack ship date). This is the one sanctioned non-item/non-lesson value of `minted_by`; every other check's `minted_by` is a real item or lesson id. **SPEC 3** (ships the starter library) pins the sentinel.

**Build reconciliation (SPEC 1 realized, 2026-07-01 — `runtime-spec-1-check-registry-impl`).** The build (61 golden-gate `node --test` gates green + `nx typecheck` clean + a 6-entry content-ring proof slice) surfaced **NO schema-shape delta** — the three schemas (`check`/`item`/`finding`), all frozen enums, all field names, and the six helper signatures were built exactly as frozen above; SPECs 2 & 3 consume them verbatim with no further reciprocal update. Four **realization clarifications** (implementation detail, not contract changes) were settled and are recorded here so the consuming specs inherit them:

1. **`.ts`-schemas + `.mjs`-helpers run via Node ≥24 native type-stripping (zero build).** Schemas are `.ts` (zod validator + `z.infer` types = single source of truth); helpers/tests are `.mjs` importing them with the explicit `.ts` extension. A typecheck-only `runtime/tsconfig.json` (`noEmit`, `allowImportingTsExtensions`, `strict`) is the `.ts` contract gate; the `runtime` nx project wires `test`/`typecheck` `run-commands` targets (`forwardAllArgs:false` to shed the workspace jest `targetDefaults`). Portability floor: Node ≥23.6 (a build step is a later extraction concern, out of scope).
2. **`resolveEvaluator({check})` stays sync + structural** (signature unchanged). `module:` specifiers are **file-resolvable paths resolved against `cwd`** (the spec's `module:backlog-lint#…` shorthand is realized as `module:.claude/skills/backlog-lint/lib/rules.mjs#ruleIdMatchesFilename`); `module:` existence is checked at resolve-time (absent file ⇒ `EvaluatorUnresolved`), while `cmd:`/`eslint:` deep existence is deferred to invoke-time. No `root` parameter was added.
3. **`skill:` (judgment) resolves but its `invoke` throws `JudgeCapabilityUnavailable`** — ring-1 does not run skills; the judge capability is SPEC 3's seam #1. Resolution (kind detection + the `flake_contract`/`JudgmentContractMissing` guard) is complete in ring-1; only invocation defers.
4. **`runCheck`/`metaCheck`/`advanceLifecycle` ship usage-stub CLIs.** Their pure cores are the frozen contract (fully gated); the CLIs need a *loaded registry* / *floor procedure* that SPEC 2 (floor) and SPEC 3 (watch-engine registry-resolving CLI) own. The `module:` heterogeneous-rule *invocation* convention (real backlog rules have varied signatures) is likewise a content-ring/SPEC-3 realization detail — ring-1 proves **resolution** (meta-check assertion 2), not heterogeneous invocation.

**Build reconciliation (SPEC 3 realized, 2026-07-01 — `runtime-spec-3-forward-edge-impl`).** One
backward-compatible delta: `resolveEvaluator({check, judge?})` and `runCheck({check, context, judge?})`
gained an **optional `judge` capability** (`(check) => Promise<Array<{detail, evidence?, scope?}>>`).
Without it, a `skill:` check's `invoke` still throws `JudgeCapabilityUnavailable` (clarification 3
unchanged); with it, invoke calls the injected judge — SPEC 3's seam #1 realized. No schema-shape
change; every SPEC 1 helper signature is otherwise consumed verbatim.

- 2026-07-03 (seam-probe): journal park/fulfil + TaskResult union re-freeze — see SPEC 3 §18.
