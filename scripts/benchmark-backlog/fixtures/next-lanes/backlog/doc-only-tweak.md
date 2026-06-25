---
id: doc-only-tweak
status: queued
rank: 10
type: task
notes: "Fix a stale path in docs/BACKLOG.md prose and a heading in a backlog file — docs-only, touches only docs/backlog."
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# doc-only-tweak: Correct a stale doc reference

A pure documentation correction. The only files touched live under `docs/backlog/` — a stale
cross-reference and a typo in a heading. No source code, no service, no CDK, no public interface,
and nothing that synthesizes or deploys. The expected lane is **Doc-layer**: work directly on
`main`, no worktree, no PR.
