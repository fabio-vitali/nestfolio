/** @jest-environment node */
type ErrorHandler = (e: {
  networkError?: { statusCode?: number };
  graphQLErrors?: { extensions?: Record<string, unknown> }[];
}) => void;

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

  it('triggers onAuthFailure on networkError statusCode 401', () => {
    capturedHandler!({ networkError: { statusCode: 401 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('triggers onAuthFailure on networkError statusCode 403', () => {
    capturedHandler!({ networkError: { statusCode: 403 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it("triggers onAuthFailure on a graphQLError with extensions.code === 'UNAUTHORIZED'", () => {
    capturedHandler!({ graphQLErrors: [{ extensions: { code: 'UNAUTHORIZED' } }] });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('does NOT trigger onAuthFailure on networkError statusCode 500', () => {
    capturedHandler!({ networkError: { statusCode: 500 } });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on a graphQLError without UNAUTHORIZED', () => {
    capturedHandler!({ graphQLErrors: [{ extensions: { code: 'BAD_USER_INPUT' } }] });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on an empty error event', () => {
    capturedHandler!({});
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
