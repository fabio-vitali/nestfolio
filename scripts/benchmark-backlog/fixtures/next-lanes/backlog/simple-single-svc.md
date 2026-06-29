---
id: simple-single-svc
status: queued
rank: 20
type: task
notes: "Routing fixture for the Simple lane: classifies as a single-service one-file off-by-one in investor-ctrl (no public interface, no deploy gate). The eval sandbox hosts no services/ tree, so the deliverable is the Simple-lane lifecycle transition (ship on main, no worktree/PR) — there is NO code file to edit here; do not hunt for one or fabricate one."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# simple-single-svc: One-file off-by-one fix in a single service (routing fixture)

By its description this is a small, self-contained fix touching exactly one file in one service
(`investor-ctrl`): no public interface, no event contract, no CDK construct, no deploy or e2e gate —
covered by the existing unit test. By those properties the correct lane is **Simple**: land directly on
`main`, no worktree, no PR.

**Sandbox note (read this — it prevents a spurious pause):** this is a *routing/classification* fixture.
The eval sandbox is docs-only and hosts no `services/` tree, so the off-by-one has no real file to edit.
Do **not** look for the service file or fabricate one. The deliverable is the **Simple-lane lifecycle
transition**: classify it Simple, ship the item on `main` (`status: shipped` + a `validation_gate`
recording that the code edit is notional in this routing sandbox), no worktree, no PR. Completing that
transition — not editing a non-existent file — is the entire done-definition.
