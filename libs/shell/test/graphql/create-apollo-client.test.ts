/** @jest-environment node */
const mockHttpLink = jest.fn().mockImplementation(() => ({ kind: 'http' }));
const mockInMemoryCache = jest.fn().mockImplementation(() => ({ kind: 'cache' }));
const mockApolloClientCtor = jest.fn().mockImplementation((opts: unknown) => ({ kind: 'client', opts }));
const mockApolloLinkFrom = jest.fn().mockImplementation((links: unknown[]) => ({ kind: 'composed', links }));
const mockOnError = jest.fn().mockImplementation((cb: unknown) => ({ kind: 'errorLink', cb }));
const mockCreateAuthLink = jest.fn().mockImplementation(() => ({ kind: 'authLink' }));
const mockCreateSubscriptionHandshakeLink = jest
  .fn()
  .mockImplementation(() => ({ kind: 'wsLink' }));

jest.mock('@apollo/client/core', () => ({
  ApolloClient: mockApolloClientCtor,
  InMemoryCache: mockInMemoryCache,
  HttpLink: mockHttpLink,
  ApolloLink: { from: mockApolloLinkFrom },
}));
jest.mock('@apollo/client/link/error', () => ({ onError: mockOnError }));
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: mockCreateAuthLink,
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: mockCreateSubscriptionHandshakeLink,
}));

// jsdom is not the default for this file; stub window.location.origin manually.
(globalThis as unknown as { window: { location: { origin: string } } }).window = {
  location: { origin: 'https://test.example.com' },
};

import { createApolloClient } from '../../src/graphql/create-apollo-client';

describe('createApolloClient', () => {
  const baseOpts = {
    domain: 'investor',
    region: 'us-east-1',
    jwtTokenProvider: jest.fn().mockResolvedValue('jwt-xyz'),
    onAuthFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds HttpLink against /graphql/<domain> (relative)', () => {
    createApolloClient(baseOpts);
    expect(mockHttpLink).toHaveBeenCalledWith({ uri: '/graphql/investor' });
  });

  it('builds the subscription link against ${window.location.origin}/realtime/<domain>', () => {
    createApolloClient({ ...baseOpts, domain: 'advisory' });
    expect(mockCreateSubscriptionHandshakeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://test.example.com/realtime/advisory',
        region: 'us-east-1',
        auth: expect.objectContaining({ type: 'AMAZON_COGNITO_USER_POOLS' }),
      }),
      expect.objectContaining({ kind: 'http' }),
    );
  });

  it('builds the auth link against the relative HTTP URI with the same auth options', () => {
    createApolloClient({ ...baseOpts, domain: 'ledger' });
    expect(mockCreateAuthLink).toHaveBeenCalledWith({
      url: '/graphql/ledger',
      region: 'us-east-1',
      auth: expect.objectContaining({
        type: 'AMAZON_COGNITO_USER_POOLS',
        jwtToken: baseOpts.jwtTokenProvider,
      }),
    });
  });

  it('composes links in order [errorLink, authLink, subscriptionLink]', () => {
    createApolloClient(baseOpts);
    expect(mockApolloLinkFrom).toHaveBeenCalledTimes(1);
    const links = mockApolloLinkFrom.mock.calls[0][0] as { kind: string }[];
    expect(links.map((l) => l.kind)).toEqual(['errorLink', 'authLink', 'wsLink']);
  });

  it('builds an ApolloClient with the composed link, an InMemoryCache, and no-cache fetch policies', () => {
    createApolloClient(baseOpts);
    expect(mockInMemoryCache).toHaveBeenCalled();
    expect(mockApolloClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        link: expect.objectContaining({ kind: 'composed' }),
        cache: expect.objectContaining({ kind: 'cache' }),
        defaultOptions: {
          query: { fetchPolicy: 'no-cache' },
          mutate: { fetchPolicy: 'no-cache' },
        },
      }),
    );
  });

  it('produces /graphql/<domain> for each of the four domains', () => {
    for (const domain of ['investor', 'advisory', 'dashboard', 'ledger']) {
      mockHttpLink.mockClear();
      createApolloClient({ ...baseOpts, domain });
      expect(mockHttpLink).toHaveBeenCalledWith({ uri: `/graphql/${domain}` });
    }
  });
});
