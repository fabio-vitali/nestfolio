/** @jest-environment node */
type ErrorEvent = { error: unknown };
type ErrorHandler = (e: ErrorEvent) => void;

let capturedHandler: ErrorHandler | undefined;

const mockOnError = jest.fn().mockImplementation((cb: ErrorHandler) => {
  capturedHandler = cb;
  return { kind: 'errorLink' };
});

jest.mock('@apollo/client/core', () => ({
  ApolloClient: jest.fn().mockImplementation(() => ({})),
  InMemoryCache: jest.fn().mockImplementation(() => ({})),
  HttpLink: jest.fn().mockImplementation(() => ({})),
  ApolloLink: { from: jest.fn().mockReturnValue({}) },
}));
jest.mock('@apollo/client/link/error', () => ({ onError: mockOnError }));

// Apollo v4 errors module — mock the discriminator helpers so the errorLink
// branch logic is exercised against shaped fixtures rather than real instances.
jest.mock('@apollo/client/errors', () => ({
  CombinedGraphQLErrors: {
    is: (e: unknown) => (e as { kind?: string })?.kind === 'graphql',
  },
  ServerError: {
    is: (e: unknown) => (e as { kind?: string })?.kind === 'server',
  },
}));

jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn().mockReturnValue({}),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn().mockReturnValue({}),
}));

(globalThis as unknown as { window: { location: { origin: string } } }).window = {
  location: { origin: 'https://test.example.com' },
};

import { createApolloClient } from '../../src/graphql/create-apollo-client';

describe('errorLink', () => {
  let onAuthFailure: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedHandler = undefined;
    onAuthFailure = jest.fn();
    createApolloClient({
      domain: 'investor',
      region: 'us-east-1',
      jwtTokenProvider: jest.fn().mockResolvedValue('jwt'),
      onAuthFailure,
    });
    expect(capturedHandler).toBeDefined();
  });

  it('triggers onAuthFailure on a ServerError with statusCode 401', () => {
    capturedHandler!({ error: { kind: 'server', statusCode: 401 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('triggers onAuthFailure on a ServerError with statusCode 403', () => {
    capturedHandler!({ error: { kind: 'server', statusCode: 403 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it("triggers onAuthFailure on CombinedGraphQLErrors carrying extensions.code === 'UNAUTHORIZED'", () => {
    capturedHandler!({
      error: { kind: 'graphql', errors: [{ extensions: { code: 'UNAUTHORIZED' } }] },
    });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('does NOT trigger onAuthFailure on a ServerError with statusCode 500', () => {
    capturedHandler!({ error: { kind: 'server', statusCode: 500 } });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on CombinedGraphQLErrors without UNAUTHORIZED', () => {
    capturedHandler!({
      error: { kind: 'graphql', errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on a plain Error (neither GraphQL nor Server)', () => {
    capturedHandler!({ error: new Error('something else') });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
