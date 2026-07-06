# Runtime check migration — judgment tier (live judge binding + audit-* skills + CI cadence)

- **Date:** 2026-07-06
- **Backlog item:** `runtime-check-migration-judgment-tier` (epic `runtime-operationalization`, P4)
- **Status:** design approved; ready for `writing-plans`
- **Predecessor:** `runtime-check-migration-completion` (deterministic tier, SHIPPED PR#35) — landed the `*-core.mjs` wrapper pattern + registry conventions this builds on.

## 1. Goal

Make the runtime's **judgment checks actually run**. Today the judgment seam is fully specced and
schema-enforced but deliberately unbound — a `skill:` evaluator throws `JudgeCapabilityUnavailable`
because no host ever populates the `procedures` map that would derive a working judge. This workstream
builds the reusable **live judge binding** and an **expensive-check cadence dispatcher**, migrates the
**4 audit-* skills** into judgment `CheckEntry`s, and **demonstrates** the loop end-to-end.

### Acceptance (demonstrated, not asserted)

**≥1 real audit-context execution** produces findings, and **≥1 finding is routed through intake** into a
`docs/backlog/from-<check>.md` item carrying `provenance.from_finding`. The `audit-service` skill on a
single service is the intended cheapest demonstration.

## 2. Current state (verified against code, 2026-07-06)

| Fact | Evidence |
|---|---|
| `skill:` executor throws when no judge injected | `runtime/engine/lib/resolve-evaluator.mjs:34-40`; a `skill:` check missing `flake_contract` throws `JudgmentContractMissing` *first* (`:35`) |
| Error class | `runtime/engine/lib/errors.mjs:8-9` (`JudgeCapabilityUnavailable`) |
| Judge is *derived* from `runProcedure` — no 7th capability | `runtime/engine/lib/derive-judge.mjs:8-15` — `judge(check)` = `runProcedure(parsed.target, {check})`, requires `status:'done'`, returns `res.findings ?? []` |
| `procedures` map wired but never populated | `runtime/adapters/claude-code/run-procedure.mjs:2-8`; `index.mjs:14` (`makeRunProcedure({procedures})`); every live caller passes `{}` (`run-intake.mjs:65`, `run-item.mjs:33`) |
| Judgment template (the one worked example) | `runtime/content/checks/integration-test-completeness.yaml` (`evaluator.type: judgment`, `run: "skill:audit-integration-test"`, `cost_tier: expensive`, `contexts:[audit]`, `flake_contract`) |
| Template's `eval_scenario` is a STUB | `runtime/eval/scenarios/integration-test-completeness.scenario.mjs` — "existence-only, so meta-check assertion 3 passes … SPEC 2 owns judgment eval scenarios" |
| Schema enforces judgment ⇒ flake_contract | `runtime/engine/schema/check.schema.ts:82-88`; `FlakeContractSchema` `:52-57`; closed run-schemes `['cmd','module','eslint','skill']` `:16` |
| 4 audit skills exist, none referenced by any check | `.claude/skills/audit-{service,domain,system,e2e-test}/SKILL.md`; only `skill:audit-integration-test` appears in any check YAML |
| `runWatch` threads a `judge`; its CLI `main()` passes none | `runtime/engine/lib/run-watch.mjs:24` (`runWatch({…, judge})`), `:59` (CLI omits judge) |
| Selection filters by context ∩ trigger AND `cost_tier ≤ cost_ceiling` | `run-watch.mjs:15-22` (`selectChecks` / `affordable`) |
| **`schedule` trigger can't afford audit checks** | `runtime/content/triggers.yaml:10-13` — `schedule` is `contexts:[audit]` but `cost_ceiling: moderate`; audit judgment checks are `expensive` ⇒ **filtered out**. Only `epic-pre-done` (`:14-16`) and `manual` (`:17-19`) have `audit` + `expensive`. `ci` is neither a trigger nor a context. |
| Intake: finding → item, via a park/fulfil `execute` seam | `runtime/engine/lib/intake.mjs` (`selectRoute` uses `capabilities.execute`; `shapeItems` pure); driver `runtime/adapters/claude-code/run-intake.mjs` (`driveIntake` → `writeItemFile` → `docs/backlog/<id>.md` with `provenance.from_finding`) |
| Reusable headless substrate | `scripts/benchmark-backlog/runner.mjs` (`runScenario` → `spawn('claude', ['-p', …, '--output-format','stream-json', …])`, `buildClaudeArgs`, `parseStreamJson`); `judge.mjs` (`buildJudgePrompt` fenced-JSON contract, lenient `parseJudgeResult`, retry-once) |

**Design consequence:** the entire "live judge binding" reduces to *populating the `procedures` map* and
injecting it at a live audit entrypoint. Ring-1 / engine / schema are **untouched**.

## 3. Architecture — two independent seams

The runtime already separates **finding production** (`runWatch` → judge) from **finding consumption**
(`run-intake` → items). This design keeps that split; it adds nothing to ring-1.

### Seam A — the live judge binding (finding production)  [ring-2, new]

**`runtime/adapters/claude-code/audit-procedures.mjs`** builds the procedures map:

```
makeAuditProcedures({ model, timeoutMs, runScenario }) → {
  'audit-service':  fn, 'audit-domain':   fn,
  'audit-system':   fn, 'audit-e2e-test': fn,
}
```

Each `fn({ check }) → { taskId: <skillName>, status: 'done'|'failed', summary, findings: [{detail, evidence?, scope}] }`:

1. Builds an **audit prompt**: "Run the `<skill>` skill scoped to `<check.scope.paths>`. Detect
   consistency drift **read-only — do NOT modify any files**. Emit ONLY the violations as a fenced JSON
   block: ` ```json {\"findings\":[{\"detail\":…,\"evidence\":…,\"scope\":[…]}]} ``` `. An empty
   `findings` array means the property holds."
2. Calls `runScenario({ prompt, … }, 'HEAD', { model, cwd, env, pauseConvention:'n/a', timeoutMs })`
   (imported from `scripts/benchmark-backlog/runner.mjs`) with a **read-only** tool-set
   (`--allowedTools 'Bash Read Glob Grep Skill'`, no Write/Edit) so a cadence run can never mutate the
   tree. (This requires a small `runnerOpts.allowedTools` seam in `buildClaudeArgs`, or a thin local
   arg-builder that reuses `runScenario`'s spawn — see §7 open item O1.)
3. Parses the result with `parseJudgeResult` (reused from `judge.mjs`) + **retry-once** on an
   unparseable block; on second failure returns `status:'failed'` (a failed procedure surfaces as an
   evaluator error finding in `runWatch`, `run-watch.mjs:30-33` — honest, not silent).
4. Returns `{ status:'done', findings }`. `findings` are `{detail, evidence?, scope}` — `kind` is added
   downstream by `toFindings` from `check.kind` (`resolve-evaluator.mjs:18-21`).

This flows into the **existing untouched** seam: `deriveJudge(runProcedure)` → `runWatch({judge})` →
`resolveEvaluator` skill-branch → `toFindings`.

### Seam B — the cadence dispatcher (finding production, driven on a cadence)  [ring-2, new]

**`runtime/adapters/claude-code/run-audit.mjs`** — a CLI entrypoint:

1. `makeClaudeCodeCapabilities({ procedures: makeAuditProcedures({…}) })` (`index.mjs` already accepts
   `procedures`).
2. `const judge = deriveJudge(capabilities.runProcedure)`.
3. Load the registry (`loadRegistry`) + the audit trigger (`loadTriggers` → the `schedule`/`audit`
   trigger; fail-closed on a corrupt registry, mirroring `run-watch.mjs:51-56`).
4. `const findings = await runWatch({ registry, trigger, changedScope: ['**/*'], judge })` — full sweep.
5. **Emit** findings: pretty JSON to stdout + write a findings artifact
   (`runtime/.audit-findings/<runId>.json`, gitignored) so the CI job can upload it and a
   human/`/backlog-next` can route them. Exit `0` clean / `1` findings / `2` usage — same convention as
   `run-watch.mjs`.

Intake is **not** auto-driven inside the cadence job (its route classification parks for a human — see
Seam C); the dispatcher's job is to *produce* findings on a cadence.

### Seam C — intake routing (finding consumption)  [existing, unchanged]

Uses the existing `run-intake.mjs` park/fulfil driver. For the **acceptance demo** (this interactive
session as host): take ≥1 emitted finding → `node runtime/adapters/claude-code/run-intake.mjs --finding
<f.json>` → it parks a route classification → session answers `--fulfil <key> --value '{route:…}'` →
`writeItemFile` writes `docs/backlog/from-<check>.md` with `provenance.from_finding`. Fully-automated
in-CI intake (binding `execute` to a headless runner) is a deliberate follow-on.

### Data flow (end-to-end)

```
GH Actions (weekly / dispatch)
  └─ node runtime/adapters/claude-code/run-audit.mjs --on=schedule
       ├─ makeAuditProcedures ──► procedures map
       ├─ deriveJudge(runProcedure) ──► judge
       └─ runWatch({trigger:schedule[audit,expensive], judge, changedScope:'**/*'})
            └─ per audit check: resolveEvaluator(skill) ─► judge(check)
                 └─ runProcedure('audit-service',{check})
                      └─ runScenario(claude -p, read-only, structured findings)
                           └─ parseJudgeResult ─► findings[]
            └─ findings[] ─► stdout + runtime/.audit-findings/<runId>.json
                                   │
            (human / /backlog-next)│
                                   ▼
  node run-intake.mjs --finding f.json  ─park→ session route decision ─►
       writeItemFile ─► docs/backlog/from-audit-service.md (provenance.from_finding)
```

## 4. The `triggers.yaml` fix

`schedule` is `contexts:[audit]` but `cost_ceiling: moderate`, so **no `expensive` audit check can ever
fire on it** — the trigger is currently inert for its stated purpose. Fix: set `schedule.cost_ceiling:
expensive` and align its declarative `cron` to the workflow's weekly cadence (the `cron` field is
metadata; the GitHub Actions `schedule:` is the real cron). This is a content-ring edit governed by the
watch-config check; `content-ring.test.mjs` / `load-registry` re-validate it.

*(Rejected alternative: a brand-new `on: audit` trigger. Reusing `schedule` — already `[audit]` and
semantically "the scheduled audit cadence" — is cleaner and avoids a redundant trigger.)*

## 5. Content migration — 4 audit judgment checks

Four new `runtime/content/checks/audit-{service,domain,system,e2e-test}.yaml`, each mirroring
`integration-test-completeness.yaml`:

```yaml
id: audit-service
property: >
  <the consistency property this audit asserts — from the skill's SKILL.md>
kind: <drift|inconsistency|gap|staleness — per what the audit detects>
evaluator:
  type: judgment
  run: "skill:audit-service"
cost_tier: expensive
contexts: [audit]
scope:
  paths: [<the surface the audit covers>]
status: active
flake_contract:
  eval_scenario: "runtime/eval/scenarios/audit-service.scenario.mjs"   # existence-stub
  allowed_flake_rate: 0.05
  calibration: "<declared calibration target; real mechanics deferred to SPEC 2 §eval>"
  min_confidence: 0.7
provenance:
  minted_by: "runtime-check-migration-judgment-tier"
  lesson: "<origin, if any>"
  ratified: "2026-07-06"
```

Each check gets a **stub** `runtime/eval/scenarios/audit-<x>.scenario.mjs` (existence-only, mirroring the
template — satisfies meta-check assertion 3). Real calibration/flake-regression mechanics are **out of
scope** (SPEC 2 §eval, unbuilt; the epic excludes net-new eval infra). `property`, `kind`, and `scope`
are read from each skill's `SKILL.md` during planning/implementation.

## 6. CI cadence — GitHub Actions workflow

`.github/workflows/runtime-audit.yml`:

- Triggers: `workflow_dispatch` (manual) + `schedule` (weekly cron, cost-controlled).
- Steps: checkout → setup Node 24 → install Claude Code → `node runtime/adapters/claude-code/run-audit.mjs
  --on=schedule` → upload the `runtime/.audit-findings/<runId>.json` artifact. `continue-on-error` on the
  findings exit (`1`) so found drift surfaces as an artifact rather than a red build.
- Auth: `CLAUDE_CODE_OAUTH_TOKEN` repo secret (from `claude setup-token`). One-time setup; each run spends
  Max quota (cost-controlled by weekly + manual dispatch).

## 7. Testing

- **Unit (`node --test`, no live `claude`):**
  - `audit-procedures`: findings-parse (good / malformed→retry / retry-fail→`status:'failed'`), the
    read-only tool-set assertion, and the `status:'done'` contract — with `runScenario` **injected/mocked**
    (mirrors `benchmark-backlog/test/runner-args.test.mjs` verifying `buildClaudeArgs` without a live
    `claude`).
  - `run-audit`: check-selection under the audit trigger + judge-derivation wired, using a **fake judge**
    (assert the four audit checks are selected and their findings flow through).
  - The 4 new YAMLs are validated by the existing `load-registry` / `content-ring` / meta-check tests
    (registry stays green).
- **Live demo (the acceptance):** one real `run-audit`/`audit-service` headless run (cost-gated via
  AskUserQuestion per repeat count), then `run-intake` on ≥1 finding, producing a committed
  `docs/backlog/from-audit-service.md`. Evidence recorded in the item's `validation_gate`.

**Open items to resolve in the plan:**
- **O1 — read-only tool-set seam.** `buildClaudeArgs` hard-codes `--allowedTools 'Bash Read Write Edit
  Glob Grep Skill'` (`runner.mjs:44`). The audit procedure needs Write/Edit denied. Cleanest: thread an
  optional `runnerOpts.allowedTools` through `buildClaudeArgs` (additive, keeps the default; a
  `benchmark-backlog` unit test guards the default). Confirm this doesn't disturb the benchmark harness.
- **O2 — module boundary.** `runtime/adapters/**` importing from `scripts/benchmark-backlog/**` — confirm
  `module-boundaries` / `import-boundary.test.mjs` permit it; if not, lift the shared spawn helper to a
  neutral location or vendor a thin copy.

## 8. Out of scope / deferred

**Out of scope** (item `out_of_scope` + epic boundaries):
- The deterministic tier (`cmd:`/`module:`) — shipped in `runtime-check-migration-completion` (PR#35).
- CI golden-gate fixture wiring (`tools/check-*.test.mjs` → CI) — sibling `runtime-check-goldengates-ci`.
- The exclusions / content-ring migration — sibling `runtime-check-exclusions-content-ring`.
- Ring-1 engine/schema/CheckEntry changes — frozen by `runtime-realization`.
- P5 work-driver re-platform / P6 operator surface.

**Deferred to a follow-up** (to be filed via `backlog-add` at ship):
- The **3 backlog/epic-governance judgment gaps** — `epicCapturedAudit` load-bearing verdict, core-vs-captured
  `epic_role` classification, ship-time captured promote/spin-out verdict. No existing skill; needs net-new
  judge procedures (and possibly new skills) — beyond the "wrap existing audit skills" boundary of this
  workstream, and adjacent to the epic's "no net-new checks" line.
- **Real flake-contract calibration mechanics** (SPEC 2 §eval) — the judgment eval corpus with good/bad
  fixtures + n-run calibration. Today all judgment `eval_scenario`s (incl. the template's) are existence
  stubs.
- **Fully-automated in-CI intake** — binding `execute` to a headless runner so the cadence job also routes
  findings into items without a human answering the park.

## 9. Decision log (brainstorming forks)

- **D1 — Content scope.** *Chosen:* seam + the 4 audit-* skills; defer the 3 governance gaps. *Rejected:*
  "all content" (front-loads net-new judgment design onto the seam), "one skill MVP" (leaves most of the
  audit surface unmigrated). *Rationale:* the 4 audit skills already exist to wrap (a clean, mechanical
  boundary once the seam works); the 3 gaps need net-new judge logic and border the epic's "no net-new
  checks" out_of_scope.
- **D2 — Cadence host.** *Chosen:* GitHub Actions workflow (`workflow_dispatch` + weekly `schedule`).
  *Rejected:* local-schedule-only (dev-machine cadence, not in-repo automation), bind-epic-pre-done
  (epic-orchestrator mode wound down per epic D1 — rarely fires). *Rationale:* a genuinely automatic,
  in-repo, no-deploy cadence and the most reusable expensive-check pattern; cost-controlled by weekly +
  manual dispatch.
- **D3 — Findings contract.** *Chosen:* read-only-wrap (run the skill read-only with an appended
  structured-findings instruction, reuse `runScenario` + `parseJudgeResult`). *Rejected:* separate
  judge-pass over the skill's report (two headless calls), modify skills to emit findings natively
  (couples the skills to the runtime). *Rationale:* one headless call, skills unchanged, reuses the proven
  substrate.
