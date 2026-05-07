---
id: mfe-charter-migration-phase-c
status: shipped
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mfe_charter_migration.md
validation_gate: "12 commits; cf-smoke probe surfaced + fixed 4 pre-existing bugs in 3 iterations; CSP single-source + dead RuntimeConfig deletion + check-no-appsync-literals build gate (PARTIAL graduation)."
closed: "2026-04-26"
notes: "Phase C of MFE charter migration shipped PARTIAL — pillars correct as code; deploy wiring incomplete (deferred)."
---

# MFE charter migration — Phase C shipped (PARTIAL graduation)

2026-04-26 on branch `feat/c-cleanup-and-playwright`. Pillars are correct as code; deploy wiring incomplete.

**C1**: `tools/probes/cf-smoke.mjs` walks 5 MFE routes against deployed CloudFront, asserts render without console errors / failed charter-path requests. The probe surfaced FOUR pre-existing bugs in 3 iterations during execution.

**C2**: deleted dead `RuntimeConfig` + 5 MFE inline CSPs + ngsw `dataGroups` + AppSync wildcards from `csp.txt`; added `check-no-appsync-literals` build-time gate; **iter-1 CSP fix**: `blob:` keyword + `'unsafe-hashes'` + `sha256-MhtPZXr7+LpJUY5qtMutB+qWfQtMaPccfe7QXtCcEYc=` (Angular onload handler); **iter-2 CSP fix**: `sha256-wmGp6DJKu9FEjYplt1pD5S9HnB97ZkkEVu1HdQQTp90=` (es-module-shims feature-detect script) + `frame-ancestors` stripped from meta-tag variant (kept in CloudFront header). 12 commits total.

**Deferred to follow-up plan**: federation manifest still points at `http://localhost:4204/remoteEntry.json` (production deploy doesn't rewrite to relative `/mfe/<key>/*` paths; MFE buckets empty); `@primeuix/themes/aura` subpath fails runtime resolution (B2 `includeSecondaries` gap). Charter graduation requires those fixes. cf-smoke will FAIL until then — by design.
