import { postAppSyncMutation } from '../../src/shared/post-appsync-mutation';

const fetchMock = jest.fn();
global.fetch = fetchMock;

jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: () => async () => ({
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  }),
}));

describe('postAppSyncMutation', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ok: true } }),
    });
  });

  it('signs the request with SigV4 (Authorization + X-Amz-Date headers present)', async () => {
    await postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('warns and returns when appsyncUrl is empty (no fetch call)', async () => {
    await postAppSyncMutation({
      appsyncUrl: '',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('logs and skips on HTTP non-2xx (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    })).resolves.toBeUndefined();
  });

  it('logs and skips on GraphQL errors[] (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'boom' }] }),
    });
    await expect(postAppSyncMutation({
      appsyncUrl: 'https://abc.appsync-api.us-east-1.amazonaws.com/graphql',
      region: 'us-east-1',
      mutation: 'mutation Foo { foo }',
      variables: {},
    })).resolves.toBeUndefined();
  });
});
