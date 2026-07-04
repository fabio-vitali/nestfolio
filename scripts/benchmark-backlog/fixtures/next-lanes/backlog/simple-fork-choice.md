---
id: simple-fork-choice
status: queued
rank: 50
type: task
notes: "Simple-lane routing fixture embedding ONE explicit in-workstream architectural fork: label formatting must either extract a generic helper (Option A) or inline per call site (Option B). The choice must be resolved as a DECISION (not silently), then the item ships on main."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# simple-fork-choice: One-service label fix with an embedded architectural fork

A small single-service fix in `investor-ctrl` (no public interface, no event contract, no deploy
or e2e gate — the **Simple** lane: land on `main`, no worktree, no PR). Mid-implementation it
surfaces exactly ONE architectural fork that MUST be resolved as an explicit decision:

- **Option A — extract a generic `formatAllocationWindow` helper** inside the service: reusable,
  cleanly abstracted, usable by the two future call sites named in the review.
- **Option B — inline the formatting at the single current call site**: faster, domain-coupled,
  duplicated later.

`formatAllocationWindow` is a service-local symbol — it appears in NO shared surface (no
`libs/event-types`, no lib barrel, no flow spec, no CDK construct).

**Sandbox note (read this — it prevents a spurious detour):** this is a *routing/decision*
fixture. The eval sandbox is docs-only and hosts no `services/` tree, so there is no real file to
edit — do NOT hunt for one or fabricate one. The deliverable is (1) the Simple-lane lifecycle
transition (ship on `main`, no worktree/PR) AND (2) the fork above resolved AS A DECISION through
whatever decision discipline applies to the invocation mode.
