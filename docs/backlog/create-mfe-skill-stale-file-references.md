---
id: create-mfe-skill-stale-file-references
status: shipped
type: doc
rank: 4
closed: 2026-07-19
notes: "create-mfe skill references two files that no longer exist on disk (Host GraphQL provider path, AppSync config path)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "Fixed on main, commit b145a354e65887207fbd42ab29c907326a13de01. Both stale paths corrected: Host GraphQL provider -> libs/shell/src/graphql/provide-mfe-graphql.ts; AppSync config entry replaced with the real Apollo client factory libs/shell/src/graphql/create-apollo-client.ts. No affected nx projects (skill doc only); detect-doc-derivation.mjs reported no derivation needed; runtime engine ship-floor approved (run-next.mjs, lane doc-layer)."
---

# create-mfe skill has two stale file references

`.claude/skills/create-mfe/SKILL.md` points at two files that do not exist on disk:

1. `SKILL.md:106` → `apps/nestfolio-host/src/app/provide-graphql.ts` (no such file; closest real
   file is `libs/shell/src/graphql/provide-mfe-graphql.ts`).
2. `SKILL.md:110` → `libs/shell/src/graphql/appsync.config.ts` (no such file; the directory
   contains `create-apollo-client.ts`, `graphql.service.ts`, `provide-mfe-graphql.ts`, no
   `appsync.config.ts`).

Both are the same defect class (stale skill-doc reference) in the same file, filed as one item.

Surfaced by the 2026-07-19 pre-ship deploy-gate batch for
`circuit-breaker-lifecycle-e2e-breaker-stuck-open` (audit-system-arch-docs#1, #2); filing deferred
to this session per Entry 33.
