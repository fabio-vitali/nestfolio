---
id: runtime-seam-probe
status: parking
type: feature
epic: runtime-operationalization
epic_role: core
notes: "P1a probe: drive ONE real simple-lane workstream end-to-end through the engine loop (runWorker + live capabilities, session as runner) and produce the measured Task/TaskResult/ask contract-gap list — the empirical 'solid vs dream' test for the execute seam."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: null
---

# Runtime seam probe — one real workstream through the loop spine

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

Roadmap: P1a of the probes-first adoption plan (see epic body). Run INLINE — the worker is the
decision-bearing spine; never isolate it behind a subagent.
