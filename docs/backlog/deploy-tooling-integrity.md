---
id: deploy-tooling-integrity
status: parking
type: epic
notes: "Deploy gating + bundle-freshness tooling can silently do the wrong thing — test-only changes default to deploy=true; deployed bundles can lag source. Theme epic (loose: two mechanisms), 2 members."
done_when: "The deploy decision excludes test-only service changes AND a deploy-time integrity check confirms the bundle matches source; both members shipped or dropped."
scope: "Reliability of the deploy-decision / deploy-integrity tooling: detect-deploy-needed.mjs gating and post-bundle source-vs-artifact freshness."
out_of_scope:
  - "The GitHub Actions CI pipeline bring-up itself (ci-pipeline) — this is CI-adjacent tooling fixable independently of the pipeline"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Deploy-tooling integrity

Root cause: the deploy tooling can silently do the wrong thing in two ways — detect-deploy-needed.mjs lacks a Tier-0 rule for services/*/test/** so a test-only change defaults to deploy=true (false positive); and a deployed Lambda bundle can lag its source (the 2026-05-13 investor-bff CDC logic lag) with no deploy-time integrity check. Honest caveat: loose cluster — gating false-positive vs artifact staleness are different mechanisms under one 'deploy tooling reliability' root. Fix pattern: add the Tier-0 test-path rule + a bundle-vs-source integrity check.

Members (derived from `epic:` pointers):
- `detect-deploy-service-test-path-no-deploy`
- `cdk-bundle-staleness-deploy-integrity`
