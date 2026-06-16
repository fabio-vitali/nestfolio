---
id: ci-pipeline
status: parking
type: epic
notes: "CI has never run green; bring the pipeline up end-to-end (umbrella + its rehearsal last-step). Theme epic, 2 members."
done_when: "The PR + post-merge CI pipeline runs green end-to-end at least once (the bring-up is real, not theatre); both members shipped or dropped."
scope: "Bringing the GitHub Actions CI pipeline from never-green to green: OIDC/auth wiring, affected detection, deploy gating, and the required-status-check rehearsal."
out_of_scope:
  - "CI-adjacent tooling fixable independently of the pipeline (detect-deploy-service-test-path-no-deploy)"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# CI pipeline bring-up

Root cause: zero successful workflow runs have ever happened on this repo (CI has been theatre);
the whole pipeline needs bring-up before any required-status-check rehearsal can pass. The two
members are the broad bring-up and its explicit last step (the rehearsal), which is blocked on
the former.

Members (derived from `epic:` pointers):
- `ci-pipeline-bring-up` (the broad bring-up; OIDC/auth/deploy wiring)
- `pr-pipeline-required-status-check` (the rehearsal — explicitly the last step of the bring-up)
