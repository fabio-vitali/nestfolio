---
id: a3-per-bff-mfe-bucket-provisioning
status: shipped
type: infra
references: []
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_mfe_charter_migration.md
validation_gate: "MfeBucket extension construct shipped; 5 BFFs wired with one line each; cdk synth verified for all 6 stacks; B1 unblocked."
closed: "2026-04-25"
notes: "Per-MFE S3 bucket + CloudFront-OAC bucket policy + service-scoped SSM exports; mirrors kbBucketName precedent."
---

# A3 — Per-BFF MFE bucket provisioning

SHIPPED 2026-04-25 on branch `feat/a3-per-bff-mfe-buckets`: new `MfeBucket` extension construct in `libs/cdk-constructs/extensions` provisions per-MFE S3 bucket + CloudFront-OAC bucket policy + service-scoped SSM exports `mfe/bucketName` + `mfe/key`; `Facade` now also exports `api/realtimeUrl` (from `CfnGraphQLApi.attrRealtimeUrl`); `investor-web` exports `web/distributionId` at the canonical subsystem-scoped path.

`NamingService.mfeBucketName(account, mfeKey)` mirrors the `kbBucketName` precedent. All 5 BFFs wired with one line each. **onboarding-bff is the documented exception** — no Facade (CopilotKit bridge), so no `api/*` exports.

Buckets are dormant until B1 wires CloudFront origins. cdk synth verified for all 6 stacks. Third ship in the MFE charter migration roadmap; **B1 now unblocked**.
