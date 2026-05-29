---
id: detect-doc-derivation-two-level-services-path
status: shipped
type: bug
notes: "detect-doc-derivation.mjs misparses services/<domain>/<service>/...; extracts the domain (e.g. 'advisory') as svc and reports it as a 'new service' on every workstream touching an existing service."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  Fixed 2026-05-29 (Simple lane, on main) ahead of the read-model w1-w5 rollout
  (all touch services/<domain>/<bff>/, which would have tripped this on every step).
  Change: regex :72 now /^services\/([^/]+)\/([^/]+)\/(.+)$/ capturing domain+service;
  svc = leaf service name (consumed by audit-service); project.json existence check
  uses the full services/<domain>/<service>/project.json path; svcDirs map added for
  accurate display in the new-service + adapter follow-up loops.
  Verified: (a) inline parse test — ledger-bff/advisory-bff src/ paths → audit-service
  (not new-service), test/ paths skipped, -adpt detected; (b) clean main → derivation=false
  exit 10; (c) real range 52b5ab55~1...HEAD whose only services file is
  services/investor/dashboard-bff/test/... → correctly parsed as service=dashboard-bff
  and skipped (test/), where the OLD regex would have falsely reported domain 'investor'
  as a new service.
---

# detect-doc-derivation.mjs misparses two-level services/<domain>/<service> paths

## Evidence

`.claude/skills/backlog-next/detect-doc-derivation.mjs:72` matches `^services\/([^/]+)\/(.+)$` — for a file like `services/advisory/portfolio-engine-ctrl/src/service.stack.ts` the regex extracts `svc = 'advisory'` (the domain), not `'portfolio-engine-ctrl'`. Line 81 then checks `git cat-file -e <base>:services/advisory/project.json`, which fails because `services/advisory/` is a directory of services, not a project. Result: `advisory` is added to `newServices`, and the script emits misleading actions like `audit-service advisory`, `flow spec coverage for new service advisory`, and `audit-system (cross-domain consistency check for new service)`.

Surfaced 2026-05-18 during the closing phase of `agent-pipeline-backlog-trap-impl` — the PE/AN/DWC service-stack edits triggered the false-positive on `services/advisory/`, even though no new services were added and no C4/flow-spec regen was actually required.

## Cheapest next step

Update the regex on `:72` to `/^services\/([^/]+)\/([^/]+)\/(.+)$/` and use either `svc = \`${domain}/${service}\`` for downstream lookups or the leaf name alone (`svc = service`) depending on which the existing `affectedServices` consumers expect. Also fix the `git cat-file -e` check at `:81` to walk to the per-service `project.json` (`services/${domain}/${service}/project.json`).

Promote out of parking when a workstream actually needs accurate derivation routing — until then the false-positive is annoying but doesn't gate ship (controller can override by reading the script's output and applying judgement).
