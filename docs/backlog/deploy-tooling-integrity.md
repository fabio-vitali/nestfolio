---
id: deploy-tooling-integrity
status: parking
type: epic
notes: "Deploy/derivation gating + bundle-freshness tooling can silently do the wrong thing — test-only/harness-lib changes mis-gate; a frontend change returns empty services; doc-derivation always reports on resume; deployed bundles can lag source. Theme epic (loose: deploy-decision + doc-derivation + artifact freshness), 4 members."
done_when: "The deploy decision excludes test-only/harness-lib service changes AND emits a correct non-empty target for frontend/lib changes; detect-doc-derivation reports only outstanding derivation (not cumulative) and is an importable, tested pure function; a deploy-time integrity check confirms the bundle matches source; all core members shipped or dropped."
scope: "Reliability of the deploy-decision / doc-derivation / deploy-integrity tooling: detect-deploy-needed.mjs gating (incl. harness-lib fan-out + frontend empty-services), detect-doc-derivation.mjs resume-signal + testability, and post-bundle source-vs-artifact freshness."
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

The 2026-06-22 skills audit (`docs/reviews/2026-06-22-backlog-skills-audit.md`) added two more
detect-* defects that share this root (deploy/derivation tooling silently doing the wrong thing):
the detect-deploy harness-lib fan-out + frontend empty-services (the audit's only HIGH), and
detect-doc-derivation always-reporting-on-resume + being untestable.

Members (derived from `epic:` pointers):
- `detect-deploy-service-test-path-no-deploy`
- `detect-deploy-fanout-and-empty-services` (audit F-1, HIGH)
- `detect-doc-derivation-resume-and-testability` (audit F-2/F-3)
- `cdk-bundle-staleness-deploy-integrity` (self-flagged 2026-05-21 as a possibly-falsified hypothesis — drop candidate)
