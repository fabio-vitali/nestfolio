const mockSend = jest.fn().mockResolvedValue({});
const mockGetSignedUrl = jest.fn().mockResolvedValue('https://s3.example.com/presigned');

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'PutObject', input })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ _type: 'GetObject', input })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

import { publishOrUpload } from '../src/lambda/publish-or-upload';

describe('publishOrUpload', () => {
  const mockPublish = jest.fn().mockResolvedValue(undefined);
  const bus = { publish: mockPublish } as any;
  const bucket = 'test-kb-bucket';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
  });

  it('publishes inline when content is under 256KB', async () => {
    const content = { source: 'test', data: 'small payload' };
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content,
      serviceName: 'test-adpt',
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('TEST_UPDATED');
    expect(event.subject.content).toEqual(content);
    expect(event.subject.delivery).toBe('inline');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('uploads to S3 and publishes pre-signed URL when content exceeds 256KB', async () => {
    const largeContent = { source: 'test', data: 'x'.repeat(300 * 1024) };
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content: largeContent,
      serviceName: 'test-adpt',
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const event = mockPublish.mock.calls[0][0];
    expect(event.type).toBe('TEST_UPDATED');
    expect(event.subject.delivery).toBe('s3-presigned');
    expect(event.subject.url).toBe('https://s3.example.com/presigned');
    expect(event.subject.content).toBeUndefined();
  });

  it('includes eventId and timestamp in the event', async () => {
    await publishOrUpload({
      bus,
      bucket,
      eventType: 'TEST_UPDATED',
      content: { data: 'test' },
      serviceName: 'test-adpt',
    });

    const event = mockPublish.mock.calls[0][0];
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });
});
