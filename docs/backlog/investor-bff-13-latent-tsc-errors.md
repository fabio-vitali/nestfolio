---
id: investor-bff-13-latent-tsc-errors
status: parking
rank: null
type: bug
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "13 latent tsc --noEmit errors; not a deploy blocker (esbuild strips types)."
---

# investor-bff has 13 latent `tsc --noEmit` errors

Branded `TenantId`/`UserId` cast mismatches in `services/investor/investor-bff/src/transforms/{onboarding-completed,balance-updated,notification-created,user-registered}.ts`; `transactWrite` protected-access leak at `services/investor/investor-bff/src/transforms/onboarding-completed.ts:39` (transform calls a base-class protected method from outside the class); `timestamp` not on `TableEntry` / `EventPayload` interfaces (used in repository writes + broadcast-listener). Pre-existed Task 1.10; verified at parent commit `0378ec25`. NOT a Phase 9 deploy blocker — Lambda bundling uses esbuild (strips types) and CDK synth uses `ts-node` transpile-only; jest passes 72/72. Filed during InvestorProfile collapse workstream 2026-05-03. Promote as a focused cleanup pass when type debt becomes load-bearing (e.g. when a fresh service onboard lands a developer who trusts `tsc --noEmit` as a quality gate).
