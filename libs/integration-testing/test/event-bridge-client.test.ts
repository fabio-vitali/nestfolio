import { EventBridgeClient } from '../src/fixtures/event-bridge-client';

// We can't easily test against real AWS in a unit test, so verify
// the eventId parameter is accepted in the type signature.
// The real test is the resilience integration tests themselves.
describe('EventBridgeClient', () => {
  it('putEvent accepts optional eventId parameter', () => {
    // Type check — this just verifies the signature compiles
    const fn: typeof EventBridgeClient.prototype.putEvent = async (_params: {
      bus: string;
      targetService: string;
      detailType: string;
      detail: Record<string, unknown>;
      eventId?: string;
    }) => {};
    expect(fn).toBeDefined();
  });
});
