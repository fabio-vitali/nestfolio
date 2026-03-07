import { query, mutate, subscribe, resetClient } from './appsync-client';

const mockGraphql = jest.fn();
const mockGenerateClient = jest.fn(() => ({ graphql: mockGraphql }));

jest.mock('aws-amplify/api', () => ({
  generateClient: () => mockGenerateClient(),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetClient();
});

describe('query', () => {
  it('calls graphql with correct params and returns data', async () => {
    mockGraphql.mockResolvedValue({ data: { getProfile: { name: 'Test' } } });

    const result = await query('query GetProfile { getProfile { name } }', { id: '1' });

    expect(mockGraphql).toHaveBeenCalledWith({
      query: 'query GetProfile { getProfile { name } }',
      variables: { id: '1' },
    });
    expect(result).toEqual({ getProfile: { name: 'Test' } });
  });

  it('uses empty variables by default', async () => {
    mockGraphql.mockResolvedValue({ data: { result: true } });

    await query('query Q { result }');

    expect(mockGraphql).toHaveBeenCalledWith({ query: 'query Q { result }', variables: {} });
  });
});

describe('mutate', () => {
  it('calls graphql with correct params and returns data', async () => {
    mockGraphql.mockResolvedValue({ data: { setGoal: { goalId: 'g1' } } });

    const result = await mutate('mutation SetGoal($input: GoalInput!) { setGoal(input: $input) { goalId } }', {
      input: { objective: 'Retirement' },
    });

    expect(mockGraphql).toHaveBeenCalledWith({
      query: 'mutation SetGoal($input: GoalInput!) { setGoal(input: $input) { goalId } }',
      variables: { input: { objective: 'Retirement' } },
    });
    expect(result).toEqual({ setGoal: { goalId: 'g1' } });
  });
});

describe('subscribe', () => {
  it('returns a subscription object', () => {
    const mockSubscription = { subscribe: jest.fn() };
    mockGraphql.mockReturnValue(mockSubscription);

    const result = subscribe('subscription OnNotification { onNotification { title } }');

    expect(mockGraphql).toHaveBeenCalledWith({
      query: 'subscription OnNotification { onNotification { title } }',
      variables: {},
    });
    expect(result).toBe(mockSubscription);
  });
});

describe('resetClient', () => {
  it('clears cached client so a new one is created', async () => {
    mockGraphql.mockResolvedValue({ data: {} });

    await query('q1');
    expect(mockGenerateClient).toHaveBeenCalledTimes(1);

    // Second call reuses cached client
    await query('q2');
    expect(mockGenerateClient).toHaveBeenCalledTimes(1);

    // After reset, new client is created
    resetClient();
    await query('q3');
    expect(mockGenerateClient).toHaveBeenCalledTimes(2);
  });
});
