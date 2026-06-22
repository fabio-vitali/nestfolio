---
id: deploy-tooling-integrity
status: shipped
closed: 2026-06-22
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
validation_gate: "All 4 core members shipped on feat/epic-deploy-tooling-integrity (single PR). (1) cdk-bundle-staleness-deploy-integrity: deploy-time CDC config-vs-capability INIT guard in event-processor changeDataCapture (2c57ecbc). (2) detect-deploy-fanout-and-empty-services: harness-lib seed + frontend deploy-target resolution. (3) detect-deploy-service-test-path-no-deploy: TIER0 services/*/test/** rule. (4) detect-doc-derivation-resume-and-testability: resume-aware --base + testable classifyDerivation pure fn. E6 batched gate: deploy 28/28 stacks ✅ to dev (the event-processor change fans out to all CDC consumers). Member-1 guard PROVEN NO-OP in deployed dev — CloudWatch sweep: 0 guard throws across all 21 CDC EgressPublisher Lambdas + 0 INIT/Runtime errors. Unit: 28/28 (event-processor) + 40/40 (backlog-next skill suite). Targeted CDC e2e per user decision: JEST_PATH='(investor|execution|ledger)-contract-emission' → 3 suites / 13 tests passed at tip ca2852d4 (fresh). Integration-suite reds were NON-epic: environmental DNS-under-parallelism (getaddrinfo ENOTFOUND, recovered to green at --parallel=1) + pre-existing AgentCore-availability (4 advisory ctrls) + the already-tracked blocked-decision-reason-from-violations blockReason drift (dashboard-bff). Captured member detect-deploy-test-lib-reverse-reach-fanout audited as genuinely orthogonal → spun out to deploy-tooling-integrity-leftovers."
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
