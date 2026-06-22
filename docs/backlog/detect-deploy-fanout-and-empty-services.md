---
id: detect-deploy-fanout-and-empty-services
status: active
type: tooling
notes: "detect-deploy-needed.mjs is wrong two ways for E6's --services=<from-detect>: a test-only harness-lib change (test-support) fans out to its full dependent closure (27 services), and a frontend/libs/ui change returns deploy=true with empty services=[] (resolver filters to root.startsWith('services/')) → silent deploy no-op against stale code."
references: []
out_of_scope:
  - "deploy.sh itself — its phase machinery (Phase 4a/4b/4c, deploy-shell, deploy-mfes.sh) is unchanged; this member only fixes what --services= detect-deploy emits."
  - "The sibling halves already shipped — detect-deploy-needed-domain-layer-blind (domain-layer empty-services) and the true-affected resolver (shared-lib services= resolution)."
  - "detect-doc-derivation.mjs resume/testability bug (F-2/F-3) — that is a separate epic member (detect-doc-derivation-resume-and-testability)."
  - "Minimising frontend over-approximation — a frontend change conservatively over-deploying (e.g. investor-web + all consuming MFEs) is acceptable and trustworthy; only an empty/missing target is the bug."
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: deploy-tooling-integrity
epic_role: core
---

# detect-deploy-needed: harness-lib fan-out + empty-services for frontend/lib

Audit finding F-1 (HIGH). See `docs/reviews/2026-06-22-backlog-skills-audit.md` (the only HIGH).
The sibling members already shipped the *other* halves — `detect-deploy-needed-domain-layer-blind`
(domain-layer empty-services) and the true-affected resolver (shared-lib `services=` resolution).
This item is scoped to the **two still-unfixed halves**:

1. **Harness-lib fan-out.** A test-only `libs/test-support` (and `integration-testing`) change is
   TIER1 and the resolver runs on it, fanning out to the full dependent closure (the run printed 27
   services for a `test-support` change; the model only avoided over-deploying by overriding from
   cross-session memory). These libs have no deployed runtime consumers. Fix: add `noRuntimeDeploy: true`
   to those TIER1 rules and seed the fan-out only from real-deploy triggers; if every trigger is
   `noRuntimeDeploy`, return deploy=false.
2. **Frontend/lib empty-services.** `apps/investor-web` and `libs/ui` are TIER1 → `deploy=true`, but
   the resolver filter `root.startsWith('services/')` (lines ~154-156) drops them → `services=[]`.
   `deploy.sh` with an empty `--services=` is a silent no-op → E6 e2e runs against **stale code**
   (false-green or spurious red). The frontend IS deployable, so the filter is wrong — emit the
   correct frontend deploy target (or an explicit frontend-deploy signal).

## Done when

A test-only harness-lib change yields `deploy=false` (or an empty real-deploy set, not a 27-service
fan-out); a frontend/`libs/ui` change yields a non-empty, correct `--services=`/frontend target; E6's
`--services=<from-detect>` is trustworthy without a human override; regression tests cover both.

## Out of scope

- `deploy.sh` itself — its phase machinery (Phase 4a/4b/4c, `deploy-shell`, `deploy-mfes.sh`) is unchanged; this member only fixes what `--services=` detect-deploy emits.
- The sibling halves already shipped — `detect-deploy-needed-domain-layer-blind` (domain-layer empty-services) and the true-affected resolver (shared-lib `services=` resolution).
- `detect-doc-derivation.mjs` resume/testability bug (F-2/F-3) — separate epic member `detect-doc-derivation-resume-and-testability`.
- Minimising frontend over-approximation — a frontend change conservatively over-deploying is acceptable; only an empty/missing target is the bug.
