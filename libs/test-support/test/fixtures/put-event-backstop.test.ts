import { mockClient } from 'aws-sdk-client-mock';
import { EventBridgeClient as AwsEBClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { EventBridgeClient } from '../../src/fixtures/event-bridge-client';
import type { TestContext } from '../../src/context';

const ebMock = mockClient(AwsEBClient);

function fakeCtx(): TestContext {
  return {
    tenantId: 'integ-tenant',
    userId: 'integ-user',
    prefix: 'dev',
    region: 'us-east-1',
    ssm: { busArn: async () => { throw new Error('ssm.busArn must not be called when subject is invalid'); } } as unknown as TestContext['ssm'],
    cleanup: { register: () => undefined } as unknown as TestContext['cleanup'],
    timings: { eventTimeout: 1, pollInterval: 1, canaryTimeout: 1, putEventRetries: 0, putEventBackoffMs: 0 },
  };
}

beforeEach(() => ebMock.reset());

it('runtime backstop: rejects an invalid typed subject before any network call', async () => {
  const client = new EventBridgeClient(fakeCtx());
  await expect(
    client.putEvent({
      bus: 'advisory',
      targetService: 'compliance-ctrl',
      detailType: 'MANDATE_ISSUED',
      subject: { operatingMode: 'BALANCED' } as never,
    }),
  ).rejects.toThrow();
  expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(0);
});

it('runtime backstop: accepts a valid typed subject and sends exactly one event', async () => {
  ebMock.onAnyCommand().resolves({ FailedEntryCount: 0, Entries: [{ EventId: 'evt-1' }] });
  const ctx = fakeCtx();
  (ctx.ssm as unknown as { busArn: (b: string) => Promise<string> }).busArn = async () => 'arn:aws:events:us-east-1:1:event-bus/advisory';
  const client = new EventBridgeClient(ctx);
  await client.putEvent({
    bus: 'advisory',
    targetService: 'compliance-ctrl',
    detailType: 'MANDATE_ISSUED',
    subject: { mandateId: 'm-1', level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026-01-15T00:00:00.000Z', __version: 1 },
    context: { userId: 'per-test-user' },
  });
  expect(ebMock.commandCalls(PutEventsCommand)).toHaveLength(1);
});
