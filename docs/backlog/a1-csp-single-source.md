---
id: a1-csp-single-source
status: shipped
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mfe_charter_migration.md
validation_gate: "csp.txt single source verified; Pillar 5 inline-script hash baked in; new synth target tracks csp.txt in inputs for affected."
closed: "2026-04-24"
notes: "apps/nestfolio-host/csp.txt is canonical CSP; substituted at build-time and synth-time."
---

# A1 — CSP single-source of truth

SHIPPED 2026-04-24 on branch `feat/a1-csp-single-source`: `apps/nestfolio-host/csp.txt` is the canonical CSP; shell's `src/index.html.tmpl` + `scripts/emit-index-html.mjs` + Nx `prepare-index` target substitute at build-time; `investor-web/src/service.stack.ts` `readFileSync`s the same file at synth-time; new `synth` Nx target has csp.txt in inputs for affected tracking.

Pillar 5 inline-script hash `NxFByHVehWCRp13zII+PkyEbL0FVXOumU3tgjZaLf9U=` baked in. `connect-src` still admits AppSync + Cognito until B1/B3. First ship in the MFE charter migration roadmap.
