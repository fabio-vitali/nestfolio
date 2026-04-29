/**
 * Regression coverage for the USER_REGISTERED ↔ ONBOARDING_COMPLETED race
 * documented in memory/project_decision_workflow_stuck.md (2026-04-29).
 *
 * The previous implementation made TransactItems[0] an `Update` with
 * `ConditionExpression: 'attribute_exists(pk)'`. When ONBOARDING_COMPLETED
 * was processed before USER_REGISTERED's projection landed, the transaction
 * reverted atomically — DDB ConditionalCheckFailed is non-retryable in
 * event-processor (libs/event-processor/src/internal/errors.ts:31), so the
 * SQS message was dropped, no Mandate was projected, and compliance-ctrl
 * later returned BLOCKED+L2+MANDATE_MISSING for that tenant, stranding the
 * decision-workflow at EndBlocked and leaving e2e step 8 (pendingDecisions
 * ≥ 1) timing out.
 *
 * After the fix, TransactItems[0] is a `Put` that includes the email forwarded
 * via the ONBOARDING_COMPLETED subject, so the row is materialized atomically
 * regardless of USER_REGISTERED ordering.
 */

const transactWriteSpy = jest.fn();

jest.mock('../../../src/repositories/investor-profile.repository', () => ({
  InvestorProfileRepository: jest.fn().mockImplementation(() => ({
    transactWrite: transactWriteSpy,
  })),
}));

import { onboardingCompleted } from '../../../src/transforms/onboarding-completed';
import type { EventPayload, EventContext } from '@nestfolio/event-processor';

const SUBJECT = {
  tenantId: '550e8400-e29b-41d4-a716-446655440000',
  userId: 'user-1',
  email: 'investor@example.com',
  goal: { objective: 'Retirement savings' },
  horizonYears: 10,
  accountMode: 'simulation' as const,
  capitalAmount: 25_000,
  currency: 'EUR',
  riskTolerance: 2,
  riskExperience: 1,
  operatingMode: 'BALANCED' as const,
  mandateAccepted: true as const,
};

const CTX: Partial<EventContext> = {
  tenantId: SUBJECT.tenantId,
  userId: SUBJECT.userId,
  region: 'us-east-1',
  eventId: 'evt-1',
  eventType: 'ONBOARDING_COMPLETED',
  timestamp: '2026-04-29T18:41:00.000Z',
};

describe('onboardingCompleted transform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env['TABLE_NAME'] = 'test-investor-bff-table';
  });

  it('writes 7 items atomically when capitalAmount > 0', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    await onboardingCompleted({ subject: SUBJECT } as unknown as EventPayload, CTX as EventContext);

    expect(transactWriteSpy).toHaveBeenCalledTimes(1);
    const call = transactWriteSpy.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(7);
  });

  it('writes 6 items when capitalAmount is 0 (no Deposit)', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    await onboardingCompleted(
      { subject: { ...SUBJECT, capitalAmount: 0 } } as unknown as EventPayload,
      CTX as EventContext,
    );

    const call = transactWriteSpy.mock.calls[0][0];
    expect(call.TransactItems).toHaveLength(6);
  });

  it('item 0 is a Put for InvestorProfile (no Update, no attribute_exists precondition)', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    await onboardingCompleted({ subject: SUBJECT } as unknown as EventPayload, CTX as EventContext);

    const item0 = transactWriteSpy.mock.calls[0][0].TransactItems[0];
    expect(item0.Put).toBeDefined();
    expect(item0.Update).toBeUndefined();
    // Critically: no ConditionExpression — the Put is unconditional so it
    // succeeds whether or not USER_REGISTERED has projected the row first.
    expect(item0.Put.ConditionExpression).toBeUndefined();
  });

  it('item 0 InvestorProfile carries email from the ONBOARDING_COMPLETED subject', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    await onboardingCompleted({ subject: SUBJECT } as unknown as EventPayload, CTX as EventContext);

    const item0 = transactWriteSpy.mock.calls[0][0].TransactItems[0];
    expect(item0.Put.Item).toMatchObject({
      pk: `InvestorProfile#${SUBJECT.tenantId}#${SUBJECT.userId}`,
      sk: 'InvestorProfile',
      __typename: 'InvestorProfile',
      tenantId: SUBJECT.tenantId,
      userId: SUBJECT.userId,
      email: SUBJECT.email,
      operatingMode: SUBJECT.operatingMode,
      region: 'us-east-1',
    });
    expect(item0.Put.Item.onboardingCompletedAt).toBeDefined();
  });

  it('Mandate item is present with DISCRETIONARY level for production tenants', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    await onboardingCompleted({ subject: SUBJECT } as unknown as EventPayload, CTX as EventContext);

    const items = transactWriteSpy.mock.calls[0][0].TransactItems;
    const mandate = items.find((it: { Put?: { Item?: { __typename?: string } } }) => it.Put?.Item?.__typename === 'Mandate');
    expect(mandate).toBeDefined();
    expect(mandate.Put.Item.level).toBe('DISCRETIONARY');
    expect(mandate.Put.Item.tenantId).toBe(SUBJECT.tenantId);
    expect(mandate.Put.Item.userId).toBe(SUBJECT.userId);
  });

  it('Mandate level is ADVISORY for e2e tenants (forces L2 user-confirmation flow until agents emit proposed trades)', async () => {
    transactWriteSpy.mockResolvedValueOnce(undefined);

    const e2eSubject = { ...SUBJECT, tenantId: 'e2e-1777999999999' };
    await onboardingCompleted(
      { subject: e2eSubject } as unknown as EventPayload,
      { ...CTX, tenantId: e2eSubject.tenantId } as EventContext,
    );

    const items = transactWriteSpy.mock.calls[0][0].TransactItems;
    const mandate = items.find((it: { Put?: { Item?: { __typename?: string } } }) => it.Put?.Item?.__typename === 'Mandate');
    expect(mandate).toBeDefined();
    expect(mandate.Put.Item.level).toBe('ADVISORY');
  });
});
