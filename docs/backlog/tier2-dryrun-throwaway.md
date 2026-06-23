---
id: tier2-dryrun-throwaway
status: active
type: epic
notes: "THROWAWAY validation epic for the tier2-live-end-to-end-dry-run workstream. Two trivial doc-layer core members under one type:epic, used to drive a live /backlog-next-epic --auto run and assert the observable Tier-2 paths (no member file-dumps; context-isolation proxy; wx-lock). Created + torn down within that workstream — NOT real product work. Tear-down deletes this epic, both members, and the scratch doc."
done_when: "The live /backlog-next-epic --auto run drives both core members through the epic-member-worker subagent seam to status:shipped on one branch; both members shipped or dropped; results recorded in 2026-06-23-tier2-harness-spike.md; the throwaway epic torn down."
scope: "A live exercise of the Tier-2 orchestrator/worker dispatch on two trivial doc-layer members that append to a throwaway scratch doc."
out_of_scope:
  - "Any real product/code/infra change — both members touch only docs/superpowers/spikes/2026-06-23-tier2-dryrun-scratch.md (no nx project affected, so no deploy/e2e fires)."
  - "The adversarial fault-injection paths (parse-failure, blocked, override-reopen, too-large, multi-fork) — already covered 13/13 by the deterministic helper harness; cross-referenced, not driven live."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Tier-2 dry-run throwaway epic

Disposable theme epic that exists only to feed the live `/backlog-next-epic --auto`
dry-run tracked by `tier2-live-end-to-end-dry-run`. Two doc-layer core members, both
appending one line to `docs/superpowers/spikes/2026-06-23-tier2-dryrun-scratch.md`:

- `tier2-dryrun-member-a` — trivial single-file append (the bounded-work baseline).
- `tier2-dryrun-member-b` — deliberately file-heavy READS + single-file append (the
  context-isolation proxy probe: many files read inside the worker, yet the
  orchestrator's per-member context delta stays ≈ member-a's compact summary).

Both members are doc-layer (only the scratch doc is written), so `affected-projects.mjs`
returns empty → E6's deploy/e2e detectors no-op and the batched expensive e2e is skipped.

Members (derived from `epic:` pointers):
- `tier2-dryrun-member-a`
- `tier2-dryrun-member-b`
