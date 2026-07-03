---
id: runtime-seam-probe
status: shipped
type: feature
epic: runtime-operationalization
epic_role: core
notes: "P1a probe: drive ONE real simple-lane workstream end-to-end through the engine loop (runWorker + live capabilities, session as runner) and produce the measured Task/TaskResult/ask contract-gap list — the empirical 'solid vs dream' test for the execute seam."
references: []
out_of_scope:
  - "The work-driver re-platform of the backlog skills (runtime-work-driver-replatform, P5) — this probe drives ONE workstream, it does not migrate the skills."
  - "Backward-edge procedural fixes — torn curate, successor guarantees, floor visibility, key epochs (runtime-backward-edge-live, P2)."
  - "Mechanical hardening — fail-closed registry, ACMR, atomic meta.json, journal locking, registry-integrity CLI, single-active semantics, starter-pack self-containment (runtime-redteam-hardening, P2)."
  - "Check migration, judge cadence, operator surface, parity harness (their own members)."
  - "A second-host adapter — portability proof lands with the adoption e2e, not here."
spec: docs/superpowers/specs/2026-07-03-runtime-seam-probe-design.md
plan: docs/superpowers/plans/2026-07-03-runtime-seam-probe.md
topic_memory: [project_runtime_realization.md]
closed: 2026-07-04
validation_gate: "p1 contract re-freeze SHIPPED + probe run COMPLETE. Build: 8 SDD tasks + final-review fix wave (commits 1845c267..156ecba9), every task reviewed, whole-branch review READY-WITH-FIXES resolved. Gate: runtime suites 214/214 green + tsc clean + tools golden gates 125/125 (node --test, worktree direct gate). Probe: drive exits 1->3->3->3->3->0 via run-item.mjs; journal item-runtime-seam-probe 15 records; gates re-ran every wake incl. recovery from a real failed gate; execute-park fulfilled with the real victim fix (cce3641b, 38->0); ship ask survived a live HOLD deferral then completed on the human ship Choice. Contract-gap list recorded in body; seam verdict: sufficient. Victim no-agent-result-fallback-check-overbroad shipped in same PR."
---

# Runtime seam probe — one real workstream through the loop spine

**Promoted 2026-07-03** (parking → queued rank 4): the roadmap trigger fired — both P0/P1b predecessors
shipped (`runtime-make-it-fire` PR#30, `runtime-design-redteam` verdict solid-with-deltas) and the p1
contract-re-freeze delta list this probe builds on is now recorded. Next in the approved P-phase order.

The single biggest unproven bet in the runtime design is the **execute seam**: `Task`/`TaskResult`
(`engine/capabilities/index.ts`) has never been forced through real work. `engine/loop/worker.mjs` is a
26-line spine with a stub `execute`; the real work-driver is still `/backlog-next`. Before any bulk
investment (check migration, work-driver re-platform), probe the seam empirically.

**Deliverables:**

1. Drive **one real simple-lane workstream** end-to-end through `runWorker` with
   `makeClaudeCodeCapabilities` bound live (the interactive session as `runner`/`ask`, the git-native
   journal): begin → start-gate → execute → ship-gate → floor ask → actual ship. The workstream must
   genuinely ship through the loop, not alongside it.
2. Fix the known spine gap in-scope: the worker currently **ignores its own ship/hold answer**
   (`worker.mjs` returns `status: 'done'` regardless of `choice.value`) — the loop must act on the floor's
   decision to count as driving.
3. The **measured contract-gap list**: every place the seam proved too thin under real work (expected
   candidates: mid-task floor asks from inside `execute`, progress visibility, scope renegotiation,
   journal step granularity). Filed as a **spec re-freeze delta** into SPEC 1/3 (the epic's sanctioned
   escape: "a build-reconciliation delta re-freezes into SPEC 1, not here").

**Exit gate:** the workstream shipped through the loop + the gap list exists (even if empty). If the gaps
are structural (the contract shape is wrong, not just thin), STOP the epic sequence and re-freeze specs
before `runtime-work-driver-replatform` is attempted.

**Red-team pre-work (added 2026-07-03):** `runtime-design-redteam` already CONFIRMED structural contract
gaps — do the **p1 re-freeze first**, then build the probe on the re-frozen contract: `TaskResult.decision`
+ parked step key; a typed resume channel into `execute`; `journal.step` gains an `awaiting` outcome
(fulfil-then-replay re-invokes fn WITH the choice — today a paused member journals as `complete` and
wedges); declare `judge`/`gitHeadSha` as capabilities (or route judgment through `execute`);
`Summary.findings`; `Task` locus/lane; gate-step keys gain an attempt/sha epoch (a failed gate currently
replays failed forever). The probe then validates the re-frozen contract empirically instead of
rediscovering the known holes.

Roadmap: P1a of the probes-first adoption plan (see epic body). Run INLINE — the worker is the
decision-bearing spine; never isolate it behind a subagent.


## Probe evidence (2026-07-04)

Loop-driven tail executed via `node runtime/adapters/claude-code/run-item.mjs runtime-seam-probe`:
drive exit sequence **1 -> 3 -> 3 -> 3 -> 3 -> 0** (gate-fail on pre-ratchet debt; execute park + re-park
on replay; execute fulfilled with the real victim fix; ship ask parked; HOLD deferral re-asked, never
wedged; ship Choice fulfilled -> done). Journal at `<git-common-dir>/journal/item-runtime-seam-probe/`
(15 step records): the pre-ratchet FAILED gate.start is retained as history and gates re-ran fresh on
every wake (checks-not-effects live); both park kinds exercised (execute-park fulfilled with a
TaskResult, ask-park with a Choice); both floor branches proven live (hold + ship).

## Contract-gap list (measured — deliverable 3)

1. **Item gates vs whole-tree debt (the big one).** Global invariants ride every item gate whole-scope;
   the first live drive was blocked by 5 pre-existing-debt checks. Interim: baseline-exclusion ratchet
   (94 paths, binding removal contract in `gate-surfaced-source-debt`); per-file granularity proved
   BLUNT at 72 files for `no-unsafe-casts`. Proper semantics filed -> `runtime-gate-baseline-semantics`
   (captured member): baseline-relative / diff-aware item gates.
2. **Epic park-key != bubbled decision.id** (whole-branch review, Medium): the orchestrator parks members
   under `member.<id>` while the adapter's decision.id is `execute:<id>`. Convention documented in SPEC 3
   §18 + GUIDE (always fulfil by `pending[].key`); a structural unification belongs to
   `runtime-work-driver-replatform` (P5).
3. **Items need scope discipline.** This item had no `scope:` frontmatter -> `Task.scope: []` -> zero
   gate-context checks selected by scope (only invariants rode). Harmless here; for P5 the item store
   must carry validated scope (`runtime-item-schema-reconciliation` covers the read-path validation).
4. **Minor driver ergonomics:** CLI JSON fulfil values are clunky but workable; `run-gate.mjs` ignores
   its `boundary` param (pre-existing — start/ship run identical sets; noted for the check migration).
5. **The re-frozen seam itself: SUFFICIENT.** Task/TaskResult(paused+decision)/choices/locus,
   park-not-complete, fulfil-is-completion, askStep recordWhen — no further type gaps surfaced under
   real use. The p1 re-freeze survived contact.
