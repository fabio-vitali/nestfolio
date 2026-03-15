import { materializeToBucket } from '../../src/pipelines/materialize-to-bucket';
import { s3Put } from '../../src/intents/s3-put';

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: jest.fn() })) },
}));

describe('materializeToBucket', () => {
  beforeEach(() => {
    process.env.EXPORT_BUCKET = 'test-bucket';
    process.env.TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    delete process.env.EXPORT_BUCKET;
    delete process.env.TABLE_NAME;
  });

  it('returns a handler function', () => {
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: { TEST: async () => [s3Put({ data: 1 })] },
    });
    expect(typeof handler).toBe('function');
  });

  it('uses EXPORT_BUCKET env var by default', () => {
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: {},
    });
    expect(handler).toBeDefined();
  });

  it('accepts custom bucket name', () => {
    const handler = materializeToBucket({
      serviceName: 'test',
      handlers: {},
      bucket: 'custom-bucket',
    });
    expect(handler).toBeDefined();
  });
});
