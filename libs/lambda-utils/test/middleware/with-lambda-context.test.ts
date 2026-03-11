import { logger } from '@nestfolio/platform-core';
import { withLambdaContext, _resetColdStart } from '../../src/middleware/with-lambda-context';

jest.mock('@nestfolio/platform-core', () => ({
  logger: {
    addContext: jest.fn(),
    appendKeys: jest.fn(),
  },
}));

describe('withLambdaContext', () => {
  const mockContext = {
    awsRequestId: 'req-123',
    functionName: 'test-fn',
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetColdStart();
  });

  it('should enrich logger with Lambda context', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const wrapped = withLambdaContext()(handler);

    await wrapped({}, mockContext);

    expect(logger.addContext).toHaveBeenCalledWith(mockContext);
    expect(logger.appendKeys).toHaveBeenCalledWith({ coldStart: true });
    expect(handler).toHaveBeenCalledWith({}, mockContext);
  });

  it('should report coldStart=true only on first invocation', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const wrapped = withLambdaContext()(handler);

    await wrapped({}, mockContext);
    expect(logger.appendKeys).toHaveBeenCalledWith({ coldStart: true });

    jest.clearAllMocks();
    await wrapped({}, mockContext);
    expect(logger.appendKeys).toHaveBeenCalledWith({ coldStart: false });
  });

  it('should skip context enrichment when no context is provided', async () => {
    const handler = jest.fn().mockResolvedValue('ok');
    const wrapped = withLambdaContext()(handler);

    await wrapped({});

    expect(logger.addContext).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith({}, undefined);
  });
});
