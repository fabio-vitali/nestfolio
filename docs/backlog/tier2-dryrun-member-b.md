---
id: tier2-dryrun-member-b
status: parking
type: tooling
notes: "THROWAWAY dry-run member B — deliberately file-heavy READS + single-file doc-layer append. The context-isolation proxy probe: many reads inside the worker, compact summary out."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: tier2-dryrun-throwaway
epic_role: core
---

# Tier-2 dry-run member B — file-heavy reads, single-file append

THROWAWAY member of `tier2-dryrun-throwaway`. Doc-layer WRITE (only the scratch doc),
but deliberately heavy on READS so the orchestrator's per-member context delta can be
compared against member A's. The proxy assertion: despite reading many files here, the
orchestrator sees only this member's compact `MEMBER-SUMMARY` — its context delta stays
≈ member A's, i.e. independent of files-touched.

## Cheapest path

1. READ each of these files in full (they only enter the WORKER's context, never the
   orchestrator's — that isolation is exactly what is being probed):
   - `.claude/skills/backlog-next-epic/SKILL.md`
   - `.claude/skills/backlog-next/SKILL.md`
   - `services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`
   - `docs/architecture/SYSTEM-ARCHITECTURE.md`
   - `docs/architecture/SERVICE-INVENTORY.md`

2. Append exactly this one line to the end of
   `docs/superpowers/spikes/2026-06-23-tier2-dryrun-scratch.md`:

   `- [member-b] appended by the Tier-2 live dry-run after reading 5 files`

3. That single-line write is the entire CHANGE. Reads are not changes — no nx project is
   affected, no deploy, no e2e.

## Done when

The line above is present in the scratch doc on the epic branch and the member is
committed `status: shipped`. The reads above are the file-heavy load whose context cost
must stay inside the worker.
