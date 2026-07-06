---
id: runtime-check-migration-judgment-tier
status: shipped
closed: 2026-07-06
type: feature
rank: 4
epic: runtime-operationalization
epic_role: core
notes: "P4 tier 2 (split from runtime-check-migration-completion 2026-07-06): the JUDGMENT tier of the check migration. Migrate the 4 audit-* skills (audit-service/-domain/-system/-e2e-test) + backlog-lint captured-audit + the 2 judgment gaps (core-vs-captured epic_role classification, ship-time captured promote/spin-out verdict) into skill:/judgment CheckEntries with flake_contracts. Requires building the live judge binding (the skill: executor is a stub throwing JudgeCapabilityUnavailable; makeRunProcedure({procedures}) is never populated — inject procedures[<audit-skill>] via a real headless claude -p invocation, reusing scripts/benchmark-backlog) AND an expensive-check cadence dispatcher (audit-context / schedule / epic-batch — none wired today; only commit is live). Acceptance: >=1 real audit-context execution with findings routed through intake. Needs its own brainstorming (genuinely novel infra)."
references: []
out_of_scope:
  - "The deterministic tier (cmd:/module: surfaces) — already SHIPPED in runtime-check-migration-completion (PR#35); not re-migrated here."
  - "CI golden-gates wiring (tools/check-*.test.mjs fixtures → CI) — sibling member runtime-check-goldengates-ci."
  - "The exclusions / content-ring migration — sibling member runtime-check-exclusions-content-ring."
  - "Re-designing ring-1 engine contracts (schemas/helpers/CheckEntry shape) — frozen by runtime-realization; a build-reconciliation delta re-freezes into SPEC 1, not here."
  - "Authoring NET-NEW judgment checks beyond migrating existing enforcement — new lessons flow through the backward edge / backlog-add."
  - "The P5 work-driver strangler re-platform and the P6 operator surface."
spec: docs/superpowers/specs/2026-07-06-runtime-check-migration-judgment-tier-design.md
plan: docs/superpowers/plans/2026-07-06-runtime-check-migration-judgment-tier.md
topic_memory: [project_runtime_realization.md]
validation_gate: "Live judge binding + cadence dispatcher + 4 audit judgment checks + CI cadence, all TDD. Commits: d0efef48 (allowedTools seam in buildClaudeArgs), b06ce519 (audit-procedures.mjs — Seam A, populates the runProcedure map for the 4 audit-* skills read-only), 11662d9a (run-audit.mjs — Seam B cadence dispatcher + gitignored findings artifact), 39428b3b (4 audit-{service,domain,system,e2e-test}.yaml judgment checks + stub eval scenarios + schedule cost_ceiling moderate→expensive fix), cba9ff48 (.github/workflows/runtime-audit.yml weekly+dispatch), 92022e41 (acceptance demo). Registry: loaded 34 check(s), 0 error(s) (30+4). Tests: full runtime suite 327/0 (pnpm nx test runtime); nx run-many test over runtime,tools green + runtime typecheck green (neither has a lint target); meta-check+content-ring 14/0. ACCEPTANCE (demonstrated, not asserted): `node runtime/adapters/claude-code/run-audit.mjs --on=manual --only=audit-e2e-test` (Opus, read-only tool-set) fired the live binding end-to-end and produced 3 REAL findings (count:3, artifact runtime/.audit-findings/audit-manual-local.json); finding audit-e2e-test#0 (EventBusTrap imported from @nestfolio/integration-testing across 4 e2e files — verified real by grep) routed through run-intake.mjs (park exit 3 → --fulfil route:orphan) into docs/backlog/from-audit-e2e-test.md carrying provenance.from_finding=audit-e2e-test#0, from_check=audit-e2e-test. ship-recheck clean (ship:runtime-check-migration-judgment-tier:gate-clean); mint considered → none (a20247d6-era). No deploy: all changes Tier-0 (detect-deploy-needed exit 10). Deferred follow-ups filed (spec §8): runtime-judgment-governance-gaps, runtime-judgment-flake-calibration, runtime-audit-auto-intake-ci. MANUAL SETUP (workflow inert until done): add repo secret CLAUDE_CODE_OAUTH_TOKEN via `claude setup-token` — then workflow_dispatch a first run to confirm CI auth."
---

# Runtime check migration — judgment tier (live judge binding + audit-* skills)

Split from `runtime-check-migration-completion` (the deterministic tier) on 2026-07-06 per that workstream's
scope decision. The deterministic tier migrated the `cmd:`/`module:` surfaces onto the live commit gate. THIS
item is the judgment tier — the genuinely-novel infra the deterministic tier deliberately excluded.

## Scope

- **The 4 audit-* skills** → `skill:` judgment CheckEntries (mirror `integration-test-completeness.yaml`):
  `audit-service`, `audit-domain`, `audit-system`, `audit-e2e-test`, each with a `flake_contract`
  (`eval_scenario` good/bad fixture pair, `allowed_flake_rate`, `calibration`, `min_confidence`).
- **backlog-lint `captured-audit` + the 2 judgment gaps** → `judgment` checks with `flake_contract`s: the
  `epicCapturedAudit` load-bearing verdict, the core-vs-captured `epic_role` classification, and the
  ship-time captured promote/spin-out verdict.
- **The live judge binding** — the `skill:` executor throws `JudgeCapabilityUnavailable` today and
  `makeRunProcedure({procedures})` is never populated by any adapter. Build the ring-2 adapter that injects
  `procedures[<audit-skill>]` with a real Skill/headless (`claude -p`) invocation and routes its findings
  through intake — reuse the proven `scripts/benchmark-backlog/` harness.
- **An expensive-check cadence dispatcher** — only `commit` has a live dispatcher; `schedule`/`epic-pre-done`/
  `ci` are stubs (`on-trigger.mjs` is an in-process Map). Wire a real dispatcher for `audit`-context /
  `expensive` checks (schedule cron and/or epic-batch and/or a CI entrypoint).
- **>=1 real audit execution** routed through intake — the binding acceptance bar (demonstrated, not asserted).

## Sequencing

Followed the deterministic tier (`runtime-check-migration-completion`, SHIPPED 2026-07-06 PR#35) — the
registry conventions + the `*-core.mjs` wrapper pattern landed there. That sequencing precondition is now
satisfied, so this item was **promoted parking → queued (rank 4) on 2026-07-06**. It still needs its own
brainstorming (novel adapter + cadence design) as its first phase — start it via
`/backlog-next runtime-check-migration-judgment-tier` (interactive, not `--auto`; the design approval gate
requires the user).
