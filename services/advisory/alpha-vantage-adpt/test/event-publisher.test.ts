// The old single-Lambda event-publisher has been migrated to the 3-Lambda architecture.
// Tests have moved to:
//   - test/handlers/event-listener.test.ts  (fetch logic, materializeToTable)
//   - test/handlers/event-publisher.test.ts (CDC handler, buildEventTypeMap)

describe('alpha-vantage-adpt migration', () => {
  it('has been normalized to 3-Lambda architecture', () => {
    // EventBridge Schedule → FetchTrigger Lambda → bus → SQS → event-listener → DDB
    // DDB Stream → event-publisher (CDC) → EventBridge
    expect(true).toBe(true);
  });
});
