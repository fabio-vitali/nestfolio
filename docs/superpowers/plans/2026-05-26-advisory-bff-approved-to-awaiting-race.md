# advisory-bff DecisionReadModel.status race fix

Backlog: `docs/backlog/advisory-bff-approved-to-awaiting-race.md`

## Root cause

`services/advisory/advisory-bff/src/transforms/decision-status-changed.ts:18-22` maps
`DECISION_APPROVED` to `status='APPROVED'` unconditionally. For L2 decisions, two
status-bearing events both fire and land in advisory-bff as independent EventBridge
→ Lambda invocations:

1. `DECISION_APPROVED` (from compliance-ctrl ComplianceCheck CDC) → writes `status='APPROVED'`.
2. `USER_CONFIRMATION_REQUESTED` (from SF state machine after DWC's sfn-callback resumes it) → writes `status='AWAITING_CONFIRMATION'`.

Event A is causally older than B (SF can only emit B after A's callback resumes the
execution), but Lambda concurrency offers no completion-order guarantee. When A's
invocation hits a cold start and B's hits a warm container, B's DDB write lands
first; A's write lands last and overwrites with `APPROVED`. Badge sticks on APPROVED;
Confirm button never appears; Playwright `new-investor-happy-path` times out at
`advisory.confirm()` after 120s.

For L1 decisions there is no race: the SF state machine routes through
`approvedL1End` (`decision-state-machine.ts:252-254`) without emitting
`USER_CONFIRMATION_REQUESTED`. `DECISION_APPROVED` → `APPROVED` is the correct
terminal state.

The `authorityLevel` field is already on `DECISION_APPROVED.subject` (set by
compliance-ctrl `event-listener.ts:143` on the ComplianceCheck row → CDC carries it
through). Consumer evidence: `decision-workflow-ctrl/sfn-callback.ts:66` already
reads `subject.authorityLevel` from the same event.

## Fix

`decision-status-changed.ts`: skip the status write when
`event.type === 'DECISION_APPROVED'` AND `event.subject.authorityLevel === 'L2'`.
L1 path unchanged. `USER_CONFIRMATION_REQUESTED` remains the sole owner of the
L2 `AWAITING_CONFIRMATION` transition, eliminating the racing writer.

```ts
const newStatus = EVENT_TO_STATUS[uow.event.type];
if (!newStatus) return undefined as unknown as WriteIntent;

// L2 decisions go DECISION_APPROVED (compliance approved, awaiting user) →
// USER_CONFIRMATION_REQUESTED (badge: AWAITING_CONFIRMATION). Both events
// land in advisory-bff as independent Lambda invocations; if DECISION_APPROVED's
// write lands last, the badge sticks on APPROVED. USER_CONFIRMATION_REQUESTED
// is the sole owner of the AWAITING_CONFIRMATION transition for L2.
if (
  uow.event.type === 'DECISION_APPROVED' &&
  (uow.event.subject as { authorityLevel?: string }).authorityLevel === 'L2'
) {
  return undefined as unknown as WriteIntent;
}
```

## Tests

### Unit (services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts)

Add to the existing suite:
- `it('should return undefined for DECISION_APPROVED when authorityLevel=L2 (USER_CONFIRMATION_REQUESTED will own the transition)')` — pass `{ authorityLevel: 'L2' }` extras, assert undefined.
- `it('should map DECISION_APPROVED to APPROVED when authorityLevel=L1 (terminal for autonomous path)')` — pass `{ authorityLevel: 'L1' }`, assert APPROVED.
- Update the existing `should map DECISION_APPROVED to APPROVED status` test to either pass `authorityLevel: 'L1'` explicitly, or document that absent authorityLevel falls through to APPROVED (defensive default — though in production it's always present).

### Integration (services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts)

Two new tests, both publish DECISION_PACKET_CREATED first, then exercise the race
in both orderings against the deployed dev table. Both must end at
`status=AWAITING_CONFIRMATION`.

- `'L2 race: DECISION_APPROVED then USER_CONFIRMATION_REQUESTED — final status=AWAITING_CONFIRMATION'`
- `'L2 race: USER_CONFIRMATION_REQUESTED then DECISION_APPROVED — final status=AWAITING_CONFIRMATION'`

Both put events synchronously back-to-back, then `waitForItem({ match: { status: 'AWAITING_CONFIRMATION' } })`
with a 60s timeout. Without the fix, the second test would have failed deterministically
(USER_CONFIRMATION_REQUESTED writes, DECISION_APPROVED overwrites with APPROVED) — but
the first test could also fail probabilistically depending on Lambda invocation timing.
With the fix, both pass deterministically.

The publish-second event in both tests must carry `authorityLevel: 'L2'` on subject
to exercise the new branch.

### Existing L1 coverage

The existing `should update status to APPROVED on DECISION_APPROVED` integration
test (line 76) does NOT pass `authorityLevel` on subject. Update it to pass
`authorityLevel: 'L1'` explicitly so it covers the (post-fix) L1 path.

## Out of scope

- LLM allocation variability (Tasks 6-7 of decision-pipeline-units-calibration-suitability already shipped).
- AgentCore maxVms quota (separate `agentcore-maxvms-prod-quota-increase`).
- Removing `DECISION_PACKET_UPDATED` from the handler map in `event-listener.ts:20-21` (Bug E's fix makes this a deliberate no-op; deleting the handler entry adds churn without behavior change).
- Generalizing to a "monotonic status transition" framework (overkill for one event; revisit only if more event-status overwrites surface).
- Audit-time enforcement of subject-field contract for `DECISION_APPROVED` (the test layer is sufficient discipline today).

## Validation gate

1. `pnpm nx run advisory-bff:test` — unit tests green.
2. `pnpm nx run advisory-bff:test-integration` — integration tests green against deployed dev (both race orderings + L1 coverage).
3. `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff` — deploy.
4. `pnpm nx run nestfolio-e2e:e2e -- --grep 'new-investor-happy-path'` — **5 consecutive passes** (raised from 2 per dossier's done-definition; the race window is thin enough that 2 may pass and 3 fail).

If any of the 5 runs fail, pull CloudWatch evidence from the failing window before
treating as flake ([[feedback-flake-means-broken]]).
