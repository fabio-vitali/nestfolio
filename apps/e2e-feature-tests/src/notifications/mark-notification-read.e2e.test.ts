import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withNotification,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario 9 — investor marks notification as read', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let notificationId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withNotification({ title: 'E2E notification', body: 'hello' }),
    ]);
    notificationId = result.notificationId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('markNotificationRead transitions status to READ in getNotifications', async () => {
    const bff = bffClient(ctx, tenant);

    // Wait for the seeded notification to be readable
    await waitForGraphQL<{
      getNotifications: { items: Array<{ notificationId: string }>; nextCursor: string | null };
    }>(
      bff.investor,
      `query Notifications { getNotifications(limit: 20) { items { notificationId } nextCursor } }`,
      {},
      (r) => r.getNotifications.items.some((n) => n.notificationId === notificationId),
      { timeoutMs: 90_000 },
    );

    // TRIGGER: mark the notification as read
    const mark = await bff.investor.mutate<{
      markNotificationRead: { notificationId: string; status: string; readAt: string | null };
    }>(
      `mutation MarkRead($notificationId: ID!) {
         markNotificationRead(notificationId: $notificationId) {
           notificationId
           status
           readAt
         }
       }`,
      { notificationId },
    );
    expect(mark.markNotificationRead.status).toBe('READ');
    expect(mark.markNotificationRead.readAt).toBeTruthy();

    // ASSERT: read-back via getNotifications confirms status=READ
    const readback = await waitForGraphQL<{
      getNotifications: { items: Array<{ notificationId: string; status: string }> };
    }>(
      bff.investor,
      `query Notifications { getNotifications(limit: 20) { items { notificationId status } } }`,
      {},
      (r) => r.getNotifications.items.find((n) => n.notificationId === notificationId)?.status === 'READ',
      { timeoutMs: 60_000 },
    );
    expect(readback.getNotifications.items.find((n) => n.notificationId === notificationId)?.status).toBe('READ');
  });
});
