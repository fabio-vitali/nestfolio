---
id: runtime-design-redteam
status: shipped
type: design
epic: runtime-operationalization
epic_role: captured
notes: "P1b SHIPPED 2026-07-03: adversarial multi-agent design review (7 lenses, 64 agents) of vision+specs vs code. VERDICT: solid-with-deltas — architecture holds (rings/registry/backward edge/journal discipline), but the seam v1 contract and journal keying have 7 confirmed criticals. Deltas routed: contract re-freeze → runtime-seam-probe; backward procedural fixes → runtime-backward-edge-live; mechanical hardening → runtime-redteam-hardening (new)."
references:
  - docs/vision/long-horizon-engineering-runtime.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: |
  7-lens multi-agent Find phase complete (64 agents, ~1.38M tokens, run wf_f5f68aa1-f4f; the
  skeptic/synthesis phases were quota-truncated — only 1 finding got the full 2-skeptic pass and
  survived 2/2). Substitute verification: every critical and load-bearing major hand-verified in the
  main session against code, including 2 empirical repros (meta-check.mjs exits 2 as its own registered
  evaluator; scope-gate --single-active exits 1 on the legal zero-active state). 27 findings survived,
  1 killed. Full finding set archived at benchmarks/2026-07-03-runtime-design-redteam-findings.json
  (gitignored, local).
---

# Runtime design red-team — VERDICT: solid-with-deltas (2026-07-03)

Adversarial multi-agent review of the vision + 3 frozen specs vs the shipped code. **The architecture
holds** — rings/seams, the check registry + lifecycle, enforcement-as-memory, the journal *discipline* —
none of the findings invalidate a load-bearing design idea. But the **seam v1 types and the journal
keying have confirmed holes** that would have wrecked the work-driver re-platform if built on as-is.
The probes-first re-scope caught this at paper cost.

## Confirmed criticals (7)

1. **Paused-wedge** (execute-seam): `TaskResult` carries no Decision/step-key and `journal.step` records
   a paused result as `complete` — a paused epic member replays the stale pause forever
   (orchestrator), and an unjournaled paused worker re-runs all side effects on resume. The pause
   protocol is structurally unexpressible through the seam as typed.
2. **Pause has no write side** (floor-headless; the one fully skeptic-verified finding, 2/2): no live
   path ever calls `journal.awaiting`/`fulfil` — `<<HARNESS-PAUSE>>` is a sentinel with no receiver.
3. **Gate replay** (journal): `gate.start`/`gate.ship` are keyed effects under a stable `item-<id>`
   runId — a failed gate replays failed forever; a re-run of a shipped item silently skips both gates.
4. **Torn curate** (backward): the guard's YAML is lowered on disk *before* `reconcileLesson` inside the
   same step; if reconcile throws, retry hits the lifecycle refusal (`retired→retire` illegal) and the
   `mints:` pointer is permanently inconsistent.
5. **No key epoch** (backward): `mint:<id>:ratify` on the shared `backward` runId — a legitimate re-mint
   of a retired check id replays the old result, reporting "minted" while writing nothing.
6. **Supersede lacks mint guarantees** (backward): the successor is written to disk with no
   `CheckEntrySchema` validation and no eval-scenario landing (`advance-lifecycle.mjs:31-36`,
   `curate-guard.mjs:24`).
7. **Starter pack is not portable** (portability): 3 of 6 starter checks invoke Nestfolio-only files
   (`tools/check-no-unsafe-casts.mjs`, `.claude/skills/backlog-lint/lint.mjs`) — `runtime init` on a
   fresh repo seeds checks that can never run.

## Confirmed majors (selected, grouped)

- **Seam contract**: `judge` + `gitHeadSha` are undeclared seventh capabilities (spines read them; the
  `Capabilities` type and adapter factory can't supply them — a conformant host fails every judgment
  check closed, permanently blocking epic-pre-done). `Summary` carries no `findings`/`paused` — fanOut
  severs detect→file. `Task` has no execution locus (worker hardcodes `feat/<id>`/`.wt/<id>`) and no
  lane concept. `Decision.irreversible` is enforced nowhere. Orchestrator returns `done` on an
  unanswered merge PAUSE.
- **Journal durability**: `meta.json` written non-atomically and parsed unguarded (torn meta bricks the
  run); no locking — two sessions on one runId double-execute (the journal root is *deliberately*
  shared across worktrees); step is at-least-once while comments say "exactly once".
- **Enforcement correctness**: the gate ignores `loadRegistry().errors[]` — a corrupted check YAML
  silently narrows enforcement (fail-open) and `.strict()` makes corruption trivial; `--diff-filter=ACM`
  misses renames (`git mv` bypasses the gate); `registry-integrity` — the registry's own self-check — is
  wired in BOTH rings to a CLI stub that always exits 2 (**empirical**); `single-active` requires
  exactly-one and counts epics, failing today's legal zero-active state (**empirical**, exit 1).
- **Parity map holes** (feeds P5): agent-observed side-findings (the dominant `backlog-add` source) are
  unrepresentable — `Finding.check` is required; `backlog-themes` clustering + epic leftovers spin-out
  have no designed equivalent; the MEMORY↔backlog dossier-sync half of `lint --fix` has no runtime home.

Killed by skeptics: 1 (journal-can't-enumerate-pending — refutable via run-dir listing).

## Delta routing

- **p1 (before the probe builds anything)** → `runtime-seam-probe`: re-freeze the seam contract first —
  `TaskResult.decision` + parked step key; a typed resume channel into `execute`; `journal.step` gains an
  `awaiting` outcome (fulfil-then-replay re-invokes fn WITH the choice); declare `judge`/`gitHeadSha` (or
  route judgment through `execute`); `Summary.findings`; `Task` locus/lane; gate-step keying gains an
  attempt/sha epoch.
- **p2 (before/with backward-edge-live)** → `runtime-backward-edge-live`: reconcile-before-write (or
  two-step) curate; successor gets full mint guarantees (schema validation + eval landing); the floor
  Decision must render the full candidate/successor; backward journal keys gain a lifecycle epoch.
- **p2 (mechanical hardening)** → `runtime-redteam-hardening` (new member): fail-closed registry errors,
  `--diff-filter=ACMR`, atomic+guarded meta.json, journal locking/single-writer rule, runnable
  `registry-integrity` CLI, `single-active` at-most-one + epic-aware semantics, starter-pack
  self-containment, cmd-attribution scope drift.
- **p3 (design additions, feeds P5 parity)** → noted in `runtime-work-driver-replatform`: Finding
  currency for agent-observed findings; themes-clustering + leftovers spin-out mechanism; dossier-sync
  home. Plus honesty fixes: at-least-once language, ledger GC.

Roadmap: P1b of the probes-first adoption plan — complete.
