import { request as confirmRequest } from '../../../src/graphql/js-function/confirm-decision.fn.js';
import { request as rejectRequest } from '../../../src/graphql/js-function/reject-decision.fn.js';
import { request as recordViewRequest } from '../../../src/graphql/js-function/record-explanation-view.fn.js';

// Regression: BFF mutation resolvers must persist `region` on every new row.
// The CDC publisher reads `record.region` into `context.region`; consumer SQS
// pipelines reject events missing `context.region` (parse-sqs-record). A row
// written without region silently drops its CDC event downstream.
describe('advisory-bff mutation resolvers persist region', () => {
  const stash = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    region: 'us-east-1',
    tableName: 'advisory-bff-table',
  };

  it('confirm-decision writes region on the UserConfirmation row', () => {
    const op = confirmRequest({
      stash,
      arguments: { decisionId: 'decision-1' },
      prev: { result: {} },
    });
    const putItem = op.transactItems.find((t: { operation: string }) => t.operation === 'PutItem');
    expect(putItem.attributeValues.region).toEqual({ S: 'us-east-1' });
  });

  it('reject-decision writes region on the UserRejection row', () => {
    const op = rejectRequest({
      stash,
      arguments: { decisionId: 'decision-1', reason: 'not now' },
      prev: { result: {} },
    });
    const putItem = op.transactItems.find((t: { operation: string }) => t.operation === 'PutItem');
    expect(putItem.attributeValues.region).toEqual({ S: 'us-east-1' });
  });

  it('record-explanation-view writes region on the UserInteraction row', () => {
    const op = recordViewRequest({
      stash,
      arguments: { decisionId: 'decision-1' },
    });
    expect(op.operation).toBe('PutItem');
    expect(op.attributeValues.region).toEqual({ S: 'us-east-1' });
  });
});
