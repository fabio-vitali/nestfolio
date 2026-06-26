---
id: ip-ctrl-snapshot-agent-fed-trigger-row
status: parking
type: bug
epic: read-model-trigger-subject-conflation
epic_role: core
notes: "IP-ctrl passes the raw CDC trigger row as the agent's investorProfile; MANDATE_ISSUED feeds it a Mandate row (no goal/riskProfile) → degraded snapshot rebuild."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
validation_gate: null
---

# investor-profile-ctrl feeds the snapshot agent the raw trigger row as `investorProfile`

`investor-profile-ctrl`'s `runSnapshotAgent`
(`services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`) passes the
raw CDC `subject` as the snapshot agent's `investorProfile` input
(`investorProfile: subject` → `src/agent-service.ts` reads `subject.investorProfile`).

- For `INVESTOR_PROFILE_UPDATED` the subject IS the full InvestorProfile composite row
  (goal / riskProfile / accountMode / operatingMode) → correct rebuild.
- For `MANDATE_ISSUED` the subject is the **Mandate sibling row** (mandateId / level /
  status / operatingMode / effectiveDate — NO goal/riskProfile/accountMode), so the
  investor-profile agent rebuilds the `InvestorProfileSnapshot` from a Mandate row →
  degraded/wrong snapshot.

**Pre-existing on `main`** — `MANDATE_ISSUED` has always carried the Mandate row.
Surfaced 2026-06-03 during `read-model-ownership-mandate-projection-fix`'s final
holistic review: that workstream re-sourced `OPERATING_MODE_CHANGED` onto the Mandate
row and **dropped IP-ctrl's `OPERATING_MODE_CHANGED` subscription** (commit `8d54cf9d`)
to avoid extending the degradation to mode changes — but the `MANDATE_ISSUED` case
remains.

**Bounded:** at onboarding `INVESTOR_PROFILE_CREATED` (insert) is NOT consumed by
IP-ctrl (it subscribes to `INVESTOR_PROFILE_UPDATED`, not `_CREATED`), so the FIRST
`InvestorProfileSnapshot` may be built from the Mandate row until the next
`INVESTOR_PROFILE_UPDATED`. The DWC decision pipeline reads the snapshot via its
`SnapshotProjectorIngress` mirror, so a degraded first-cycle snapshot could propagate
into a first decision.

**Candidate fixes:**
- (a) Drop IP-ctrl's `MANDATE_ISSUED` rebuild trigger — mandate issuance is not a
  profile change; the profile rebuild belongs on `INVESTOR_PROFILE_*`.
- (b) For any mandate-triggered rebuild, read the actual InvestorProfile row from the
  source rather than using the trigger `subject` as `investorProfile`.

**Promote when** the advisory decision e2e shows a degraded first-cycle
`InvestorProfileSnapshot`, or when next touching IP-ctrl's snapshot rebuild path.

See [[project_read_model_redesign]].
