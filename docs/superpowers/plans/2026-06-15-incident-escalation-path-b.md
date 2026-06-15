# Incident-escalation Path B removal + Path C wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four dead escalation/incident event constants and wire `investor-ctrl` to notify investors when a broker order escalates (`ORDER_ESCALATED`).

**Architecture:** `investor-ctrl` gains an `ORDER_ESCALATED` handler mirroring its existing `ORDER_REJECTED` handler (the event already flows broker-ctrl → ExecutionBus → investor-adpt FromExecution → InvestorBus). The dead `ESCALATION_TRIGGERED` / `INCIDENT_DETECTED` / `INCIDENT_RESOLVED` / `USER_CONFIRMATION_REQUESTED` constants — whose original goals are realized by the authority-resolver+taskToken design and domain-specific containment — are deleted along with their orphan adapter-forwarding entries and one unreachable dashboard-bff handler. Flow spec, architecture docs, C4, and the 5 affected service cards are regenerated.

**Tech Stack:** TypeScript, AWS CDK (EventBridge Rules / Ingress construct), event-processor (`materializeToTable`, `record`, `parseSubject`), Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-06-15-incident-escalation-path-b-design.md`

**Ordering rule (build stays green at every commit):** wire the new path first (Task 1), then remove constant *usages* (Task 2), then the *declarations* (Task 3). Removing a usage while the unused declaration remains compiles fine; removing the declaration only after all usages are gone compiles fine.

---

### Task 1: investor-ctrl — wire `ORDER_ESCALATED` → Notification

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts` (add template + handler)
- Modify: `services/investor/investor-ctrl/src/service.stack.ts:30` (add subscription)
- Test: `services/investor/investor-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/unit/event-listener.test.ts`, add a template test inside the `describe('getNotificationTemplate', …)` block (after the `BROKER_HEAL_ESCALATED` case, ~line 184):

```typescript
    it('returns correct template for ORDER_ESCALATED', () => {
      const t = getNotificationTemplate('ORDER_ESCALATED');
      expect(t.title).toBe('Order Needs Review');
      expect(t.channel).toBe('email,push');
    });
```

And add a new `describe` block after the `WriteIntents — ORDER_REJECTED, DECISION_BLOCKED, WITHDRAWAL_SETTLED` block (~line 459), reusing the existing `normalizedOrderSubject` builder:

```typescript
  describe('WriteIntents — ORDER_ESCALATED', () => {
    it('creates a Notification for ORDER_ESCALATED with ORDER entity + email,push channel', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_ESCALATED', normalizedOrderSubject({ orderId: 'ord-esc-1' }), { tenantId: 'tenant-1', eventId: 'evt-esc-1' }),
      ]);
      expect(result.errors).toHaveLength(0);
      expect(result.intents).toHaveLength(1);
      expect(result.intents[0]).toMatchObject({
        _tag: 'record',
        typename: 'Notification',
        fields: expect.objectContaining({
          type: 'ORDER_ESCALATED',
          title: 'Order Needs Review',
          channel: 'email,push',
          status: 'DELIVERED',
          relatedEntityType: 'ORDER',
          relatedEntityId: 'ord-esc-1',
          tenantId: 'tenant-1',
        }),
      });
    });

    it('ORDER_ESCALATED with empty subject throws ZodError (contract enforcement)', async () => {
      const result = await harness.process([
        fakeSqsRecord('ORDER_ESCALATED', {}, { tenantId: 't-zod', eventId: 'evt-zod-esc' }),
      ]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toBeInstanceOf(ZodError);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test investor-ctrl --skip-nx-cache -- -t "ORDER_ESCALATED"`
Expected: FAIL — the template test gets the fallback title `'Notification'`, and the WriteIntent test gets `result.skipped === 1` (no handler registered) so `result.intents` is empty.

- [ ] **Step 3: Add the notification template**

In `src/handlers/event-listener.ts`, add to `NOTIFICATION_TEMPLATES` immediately after the `ORDER_REJECTED` entry (after line 82):

```typescript
  ORDER_ESCALATED: {
    title: 'Order Needs Review',
    body: 'A trade order could not be completed automatically and has been escalated for review. Check your dashboard for details.',
    channel: 'email,push',
  },
```

- [ ] **Step 4: Add the handler**

In `src/handlers/event-listener.ts`, add immediately after the `ORDER_REJECTED` handler (after line 222, inside the `createHandlers` return object):

```typescript
  [ExecutionCrossDomainEventTypes.ORDER_ESCALATED]: async (
    payload: EventPayload,
    ctx: EventContext,
  ): Promise<WriteIntent> => {
    const subject = parseSubject(payload, NormalizedOrderEventSchema);
    return buildNotificationRecord(ctx.tenantId, ctx, 'ORDER', subject.orderId);
  },
```

- [ ] **Step 5: Add the subscription**

In `src/service.stack.ts`, add to the `triggerIngress` `eventTypes` array after line 30 (`BROKER_HEAL_ESCALATED`):

```typescript
        InvestorIngestEventTypes.ORDER_ESCALATED,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm nx test investor-ctrl --skip-nx-cache`
Expected: PASS (all investor-ctrl unit tests, including the new ORDER_ESCALATED cases).

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-ctrl/src/handlers/event-listener.ts \
        services/investor/investor-ctrl/src/service.stack.ts \
        services/investor/investor-ctrl/test/unit/event-listener.test.ts
git commit --no-verify -m "feat(investor-ctrl): notify investor on ORDER_ESCALATED (wire Path C)"
```

---

### Task 2: Remove orphan usages (forwarding entries + dead dashboard-bff handler)

**Files:**
- Modify: `services/investor/investor-adpt/src/service.stack.ts:40,44,45,46`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts:29`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts:33-34`
- Test: `services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts:11,21`

- [ ] **Step 1: Update the dashboard-bff handler-count test (the failing test)**

In `dashboard-bff/test/unit/handlers/event-listener.test.ts`:
- Change line 8/11 from 13 to 12: `expect(Object.keys(handlers)).toHaveLength(12);` (and update the `it('should export handlers for all 13 event types', …)` title to `12`).
- Delete the assertion at line 21: `expect(handlers).toHaveProperty(AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED);`

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm nx test dashboard-bff --skip-nx-cache -- -t "event types"`
Expected: FAIL — handler map still has 13 keys (the `USER_CONFIRMATION_REQUESTED` handler still exists).

- [ ] **Step 3: Delete the dead dashboard-bff handler**

In `dashboard-bff/src/handlers/event-listener.ts`, delete lines 33-34:

```typescript
    [AdvisoryCrossDomainEventTypes.USER_CONFIRMATION_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      recentActivity(toUow(payload, ctx)),
```

- [ ] **Step 4: Delete the dashboard-bff Ingress subscription**

In `dashboard-bff/src/service.stack.ts`, delete line 29:

```typescript
        InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
```

- [ ] **Step 5: Delete the four investor-adpt FromAdvisory forwarding entries**

In `investor-adpt/src/service.stack.ts`, delete these four lines from the `fromAdvisoryEvents` array (lines 40, 44, 45, 46) so the array keeps only `DECISION_PACKET_CREATED`, `EXPLANATION_GENERATED`, `DECISION_APPROVED`, `DECISION_BLOCKED`, `ADVISORY_STATUS_UPDATED`:

```typescript
      InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
      InvestorIngestEventTypes.ESCALATION_TRIGGERED,
      InvestorIngestEventTypes.INCIDENT_DETECTED,
      InvestorIngestEventTypes.INCIDENT_RESOLVED,
```

- [ ] **Step 6: Run the affected unit tests to verify they pass**

Run: `pnpm nx test dashboard-bff --skip-nx-cache && pnpm nx test investor-adpt --skip-nx-cache`
Expected: PASS. (If `investor-adpt/test/unit/service.stack.test.ts` is a CDK snapshot/rule-shape test asserting the FromAdvisory event list, update its expectation to the 5-event list; re-run.)

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-adpt/src/service.stack.ts \
        services/investor/dashboard-bff/src/service.stack.ts \
        services/investor/dashboard-bff/src/handlers/event-listener.ts \
        services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts
git commit --no-verify -m "refactor(investor): drop orphan forwarding + dead dashboard-bff USER_CONFIRMATION_REQUESTED handler"
```

---

### Task 3: Remove the dead constant declarations

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/domain/events.ts:7`
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts:12,15,16,17` (KEEP `USER_CONFIRMED` line 20)
- Modify: `services/investor/investor-adpt/src/domain/events.ts:27,31,32,33`

- [ ] **Step 1: Delete the `ESCALATION_TRIGGERED` declaration in compliance-ctrl**

In `compliance-ctrl/src/domain/events.ts`, delete line 7:

```typescript
  ESCALATION_TRIGGERED: eventName('ESCALATION_TRIGGERED'),
```

- [ ] **Step 2: Delete the four dead declarations in advisory-adpt**

In `advisory-adpt/src/domain/events.ts`, delete these lines from `AdvisoryCrossDomainEventTypes` (lines 12, 15, 16, 17). **Do NOT delete `USER_CONFIRMED` (line 20)** — it is the live event that resumes the decision SF:

```typescript
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  ESCALATION_TRIGGERED: eventName('ESCALATION_TRIGGERED'),
  INCIDENT_DETECTED: eventName('INCIDENT_DETECTED'),
  INCIDENT_RESOLVED: eventName('INCIDENT_RESOLVED'),
```

- [ ] **Step 3: Delete the four dead declarations in investor-adpt**

In `investor-adpt/src/domain/events.ts`, delete these lines from `InvestorIngestEventTypes` (lines 27, 31, 32, 33):

```typescript
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  ESCALATION_TRIGGERED: eventName('ESCALATION_TRIGGERED'),
  INCIDENT_DETECTED: eventName('INCIDENT_DETECTED'),
  INCIDENT_RESOLVED: eventName('INCIDENT_RESOLVED'),
```

- [ ] **Step 4: Confirm zero remaining `.ts` references**

Run:
```bash
grep -rnE 'ESCALATION_TRIGGERED|INCIDENT_DETECTED|INCIDENT_RESOLVED' services/ libs/ apps/ | grep '\.ts' | grep -v '\.md'
grep -rn 'USER_CONFIRMATION_REQUESTED' services/ libs/ | grep '\.ts'
```
Expected: the only `USER_CONFIRMATION_REQUESTED` hits are **comments/test-name strings** in `decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` (lines 421, 452), `advisory-bff/test/unit/service.stack.test.ts:64` (string literal in a "not-subscribed" list), and `advisory-bff/src/service.stack.ts:60` (comment) — all of which remain accurate and need no change. The first grep returns nothing. If any *non-comment code* reference remains, stop and investigate.

- [ ] **Step 5: Run the affected unit tests**

Run: `pnpm nx test compliance-ctrl --skip-nx-cache && pnpm nx test advisory-adpt --skip-nx-cache && pnpm nx test investor-adpt --skip-nx-cache`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/compliance-ctrl/src/domain/events.ts \
        services/advisory/advisory-adpt/src/domain/events.ts \
        services/investor/investor-adpt/src/domain/events.ts
git commit --no-verify -m "refactor: delete dead ESCALATION_TRIGGERED/INCIDENT_*/USER_CONFIRMATION_REQUESTED event constants"
```

---

### Task 4: Update the 5 affected service cards (drift gate)

The `service-card-drift` gate diffs each card's machine-derivable sections (Ingress subscriptions, Egress eventTypes, Handlers, Event Types) against `service.stack.ts` / `events.ts`. The changes above alter those sections in 5 cards.

**Files:**
- Modify: `services/investor/investor-ctrl/CLAUDE.md` (Ingress 15→16 + ORDER_ESCALATED handler)
- Modify: `services/investor/investor-adpt/CLAUDE.md` (FromAdvisory list + Event Types)
- Modify: `services/advisory/compliance-ctrl/CLAUDE.md` (Event Types — drop ESCALATION_TRIGGERED)
- Modify: `services/advisory/advisory-adpt/CLAUDE.md` (Event Types — drop the 4)
- Modify: `services/investor/dashboard-bff/CLAUDE.md` (Ingress list + recent-activity prose drops USER_CONFIRMATION_REQUESTED)

- [ ] **Step 1: Run the drift gate to see what it flags**

Run: `pnpm nx run-many -t check-service-card-drift -p investor-ctrl,investor-adpt,compliance-ctrl,advisory-adpt,dashboard-bff --skip-nx-cache`
(If the target name differs, find it: `grep -rl "service-card-drift\|check-service-card" tools/ .claude/ nx.json` and run the equivalent. The gate prints exact section diffs.)
Expected: FAIL listing the stale sections per card.

- [ ] **Step 2: Update each card's flagged sections**

Apply the gate's diffs precisely. Concretely:
- `investor-ctrl/CLAUDE.md`: bump "## Ingress Subscriptions (15)" → (16); add `ORDER_ESCALATED` to the alphabetized TriggerIngress list and to the "From investor-adpt" sublist; add an `ORDER_ESCALATED -> record('Notification')` line to the Handlers section template list.
- `investor-adpt/CLAUDE.md`: remove `ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, USER_CONFIRMATION_REQUESTED` from the `InvestorIngress-FromAdvisory` line and from the `InvestorIngestEventTypes:` Event Types line.
- `compliance-ctrl/CLAUDE.md`: remove `ESCALATION_TRIGGERED` from the `ComplianceEventTypes:` Event Types line.
- `advisory-adpt/CLAUDE.md`: remove `ESCALATION_TRIGGERED, INCIDENT_DETECTED, INCIDENT_RESOLVED, USER_CONFIRMATION_REQUESTED` from the `AdvisoryCrossDomainEventTypes:` Event Types line (keep `USER_CONFIRMED`).
- `dashboard-bff/CLAUDE.md`: remove `USER_CONFIRMATION_REQUESTED` from the `## Ingress` list; in the `recent-activity.ts` Transforms bullet, change "dispatches DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED" → "dispatches DECISION_PACKET_CREATED".

- [ ] **Step 3: Re-run the drift gate to verify green**

Run: `pnpm nx run-many -t check-service-card-drift -p investor-ctrl,investor-adpt,compliance-ctrl,advisory-adpt,dashboard-bff --skip-nx-cache`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add services/investor/investor-ctrl/CLAUDE.md services/investor/investor-adpt/CLAUDE.md \
        services/advisory/compliance-ctrl/CLAUDE.md services/advisory/advisory-adpt/CLAUDE.md \
        services/investor/dashboard-bff/CLAUDE.md
git commit --no-verify -m "docs(cards): sync 5 service cards after escalation event changes"
```

---

### Task 5: Refresh the flow spec + regenerate data-flows + validate

**Files:**
- Modify: `flows/incident-escalation.flow.yaml`
- Regenerate: `docs/data-flows/incident-escalation.md`

- [ ] **Step 1: Read the current flow spec**

Run: `cat flows/incident-escalation.flow.yaml` and `cat flows/SCHEMA.md` (for the YAML schema).

- [ ] **Step 2: Rewrite Path B and confirm Path C**

Edit `flows/incident-escalation.flow.yaml`:
- **Path B:** remove the `[UNIMPLEMENTED]` `ESCALATION_TRIGGERED` step(s) and `INCIDENT_*` references. Replace with a short note step/annotation: "L1→L2 authority escalation is realized in the decision-workflow SF (`compliance-ctrl` AuthorityResolver computes `authorityLevel`; SF `ComplianceChoice` routes L2 → RequestUserConfirmation via taskToken on the DecisionPacket) — not an event path. Generic incident response is realized domain-specifically (circuit breaker, reconciliation, order escalation)."
- **Path C:** update success_criteria so the chain completes end-to-end: broker-ctrl emits `ORDER_ESCALATED` → investor-adpt `InvestorIngress-FromExecution` forwards to InvestorBus → **investor-ctrl `TriggerIngress` consumes it and writes a `Notification` row** (the previously-missing final hop, now wired). Keep the existing failure_modes for the broker-ctrl SF timeout PutItem.
- Ensure the YAML still parses (no bare strings with unquoted colons — see the parked `order-execution-flow-yaml-parse-error` lesson).

- [ ] **Step 3: Regenerate the data-flows doc**

Run: `node tools/generate-flow-docs.mjs` (regenerates `docs/data-flows/*.md` from `flows/*.yaml`; if the script name/path differs, find it via `ls tools/ | grep -i flow`).
Expected: `docs/data-flows/incident-escalation.md` updated.

- [ ] **Step 4: Validate the flow against code**

Invoke the `validate-flow` skill for `incident-escalation` (verifies subscriptions/handlers/forwarding match code). Resolve any mismatch it surfaces.
Expected: clean — investor-ctrl now subscribes to `ORDER_ESCALATED`; the dead Path B events are gone.

- [ ] **Step 5: Commit**

```bash
git add flows/incident-escalation.flow.yaml docs/data-flows/incident-escalation.md
git commit --no-verify -m "docs(flows): incident-escalation Path B removed, Path C functional end-to-end"
```

---

### Task 6: Update architecture docs

**Files:**
- Modify: `docs/architecture/SERVICE-INVENTORY.md` (dashboard-bff line ~174; investor-ctrl section ~144)
- Modify: `docs/architecture/SYSTEM-ARCHITECTURE.md` (only if it carries an escalation/incident narrative)

- [ ] **Step 1: Update SERVICE-INVENTORY.md**

- dashboard-bff "Key events consumed" (line ~174): remove `USER_CONFIRMATION_REQUESTED` from the list.
- investor-ctrl section (starts ~line 144): add `ORDER_ESCALATED` to its "Key events consumed" list (next to `ORDER_REJECTED`). Find the exact line: `grep -n "Key events consumed" docs/architecture/SERVICE-INVENTORY.md` and locate the investor-ctrl one.

- [ ] **Step 2: Check SYSTEM-ARCHITECTURE.md for escalation/incident narrative**

Run: `grep -niE 'escalat|incident|user.?confirmation' docs/architecture/SYSTEM-ARCHITECTURE.md`
If a narrative references compliance escalation as an event or the dead constants, update it to describe the authority-resolver+taskToken realization. If no relevant hits, no change (expected — the earlier sweep found none).

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/SERVICE-INVENTORY.md docs/architecture/SYSTEM-ARCHITECTURE.md
git commit --no-verify -m "docs(architecture): sync inventory for escalation event changes"
```

---

### Task 7: Regenerate C4 diagrams

- [ ] **Step 1: Regenerate**

Invoke the `generate-c4-diagrams` skill (two-stage D2→SVG pipeline from `service.stack.ts`). The investor-ctrl subscription add + investor-adpt/dashboard-bff subscription removals change the C2/C3 derivation.

- [ ] **Step 2: Visually verify the SVG output**

Read the regenerated SVG(s) and confirm: investor-ctrl shows the new `ORDER_ESCALATED` edge; the dead escalation/incident edges are gone. (Per `feedback_verify_diagrams` — always visually verify SVG output.)

- [ ] **Step 3: Commit**

```bash
git add docs/  # the C4 D2 sources + SVGs (exact paths per the generate-c4-diagrams skill)
git commit --no-verify -m "docs(c4): regenerate diagrams after escalation event changes"
```

---

### Task 8: Full affected verification gate

- [ ] **Step 1: Compute the true-affected set and run test + lint**

Run:
```bash
AFFECTED=$(node tools/affected-projects.mjs --base=origin/main | paste -sd, -)
echo "Affected: $AFFECTED"
[ -n "$AFFECTED" ] && pnpm nx run-many -t test,lint -p "$AFFECTED" || echo "no affected projects"
```
Expected: all green. Investigate any failure before proceeding (do not deploy on red).

- [ ] **Step 2: Commit any snapshot/lint fixups**

```bash
git add -A
git commit --no-verify -m "test: update snapshots after escalation event changes" || echo "nothing to commit"
```

---

## Closing phase (handled by /backlog-next Step 6, after the plan)

- **Deploy** (dev sandbox): `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-ctrl,investor-adpt,dashboard-bff` (constant-only removals in compliance-ctrl/advisory-adpt don't change synth — `detect-deploy-needed.mjs` confirms the set).
- **Scoped validation:** affected `test-integration` for the deployed services. **No full e2e / no Playwright** — the `ORDER_ESCALATED` path is a 300s broker-SF timeout, not e2e-triggerable; the investor-ctrl unit regression is the correctness gate.
- **Ship:** set backlog `status: shipped` + fill `validation_gate`, lint, then `finishing-a-development-branch` for merge.

## Out of scope (mirrors the spec)

- Building a real compliance-escalation producer or a generic incident-response (SEV-1..5) lifecycle.
- The order-execution SF input-contract gap (parked `broker-ctrl-order-sf-input-contract-gap`).
- Whether dashboard-bff recent-activity should source an "awaiting confirmation" item from the DecisionPacket `AWAITING_CONFIRMATION` CDC path — **file a parking finding** (removing the dead handler may expose a latent feed gap).
- Stale Playwright POM comments in `apps/nestfolio-e2e` referencing the (already-dead) `USER_CONFIRMATION_REQUESTED` — they belong to the rank-5 `happy-path-decision-sf-waitfortasktoken-wedge` workstream's territory.
- `adapter-event-name` redeclare-vs-reexport hardening (parked).
