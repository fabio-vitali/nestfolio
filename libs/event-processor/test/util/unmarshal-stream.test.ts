import { unmarshalStream } from '../../src/util/unmarshal-stream';
import { fakeDdbStreamRecord } from '../../src/testing/fake-records';

describe('unmarshalStream', () => {
  it('unmarshals INSERT record with NewImage', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 100,
    });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).not.toBeNull();
    expect(result!.streamRecord.pk).toBe('T#t1');
    expect(result!.streamRecord.sk).toBe('Order#e1');
    expect(result!.streamRecord.__typename).toBe('Order');
    expect(result!.streamRecord.tenantId).toBe('t1');
    expect(result!.streamRecord.amount).toBe(100);
    expect(result!.ctx.eventName).toBe('INSERT');
    expect(result!.ctx.typename).toBe('Order');
    expect(result!.ctx.newImage).toBeDefined();
    expect(result!.ctx.oldImage).toBeUndefined();
  });

  it('unmarshals REMOVE record using OldImage', () => {
    const ddbRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).not.toBeNull();
    expect(result!.ctx.eventName).toBe('REMOVE');
    expect(result!.ctx.newImage).toBeUndefined();
    expect(result!.ctx.oldImage).toBeDefined();
  });

  it('unmarshals MODIFY record with both images', () => {
    const ddbRecord = fakeDdbStreamRecord('MODIFY', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 200,
    }, { oldImage: { pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1', amount: 100 } });
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result!.ctx.newImage!.amount).toBe(200);
    expect(result!.ctx.oldImage!.amount).toBe(100);
  });

  it('returns null for record with no image', () => {
    const ddbRecord = fakeDdbStreamRecord('REMOVE', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    // Remove OldImage to simulate NEW_IMAGE-only stream
    ddbRecord.dynamodb!.OldImage = undefined;
    const result = unmarshalStream(ddbRecord, 'test-service');
    expect(result).toBeNull();
  });

  it('sets serviceName in context', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'my-service');
    expect(result!.ctx.serviceName).toBe('my-service');
  });

  it('preserves raw DynamoDBRecord in context', () => {
    const ddbRecord = fakeDdbStreamRecord('INSERT', {
      pk: 'T#t1', sk: 'Order#e1', __typename: 'Order', tenantId: 't1',
    });
    const result = unmarshalStream(ddbRecord, 'test');
    expect(result!.ctx.record).toBe(ddbRecord);
  });
});
