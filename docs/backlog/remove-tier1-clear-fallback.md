---
id: remove-tier1-clear-fallback
status: parking
type: tooling
notes: "The Tier-2 subagent dispatch (backlog-next-epic-member-subagent-isolation) demoted the Tier-1 per-member /clear checkpoint to a dormant, clearly-labelled fallback (/backlog-next-epic E4.5) and reconciled the prose in E9 + Common mistakes. Per the spec's Goal-2 rollout, KEEP the fallback until 3 successful Tier-2 epics have run (don't delete the only known-working context mechanism before the new one is proven). Promote after 3 successful Tier-2 epics."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: tier2-epic-orchestrator-hardening
epic_role: core
---

# Remove the dormant Tier-1 `/clear` fallback (after 3 successful Tier-2 epics)

Once **3 successful Tier-2 epics** have run (each a `/backlog-next-epic` run whose members dispatched as `epic-member-worker` subagents and shipped via one PR — `tier2-live-end-to-end-dry-run` is the first; real delivery epics count too), delete:

- the `/backlog-next-epic` **E4.5 — Tier-1 `/clear` fallback** block;
- any residual `TIER1-FALLBACK` references + the re-scoped "self-measure context" Common-mistake note;
- the worker `/backlog-next` references to the dormant fallback, if any.

Leave the crash-resumability machinery (run-state + frontmatter on disk) — that is Tier-2's foundation, not Tier-1's. The trigger is deliberately "3 epics," not "1 dry-run," so the new mechanism is proven across real runs before the safety net is removed.
