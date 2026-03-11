const mockRegister = jest.fn();

jest.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: () => ({ register: mockRegister }),
}));

import { GraphqlService } from '../src/graphql.service';

const mockGraphql = jest.fn();
const mockGenerateClient = jest.fn(() => ({ graphql: mockGraphql }));

jest.mock('@nestfolio/shared-state', () => ({
  LogoutOrchestrator: class {},
}));

jest.mock('aws-amplify/api', () => ({
  generateClient: () => mockGenerateClient(),
}));

describe('GraphqlService', () => {
  let service: GraphqlService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GraphqlService();
  });

  describe('query', () => {
    it('calls graphql with correct params and returns data', async () => {
      mockGraphql.mockResolvedValue({ data: { getProfile: { name: 'Test' } } });

      const result = await service.query('query Q { getProfile { name } }', { id: '1' });

      expect(mockGraphql).toHaveBeenCalledWith({
        query: 'query Q { getProfile { name } }',
        variables: { id: '1' },
      });
      expect(result).toEqual({ getProfile: { name: 'Test' } });
    });

    it('uses empty variables by default', async () => {
      mockGraphql.mockResolvedValue({ data: { result: true } });

      await service.query('query Q { result }');

      expect(mockGraphql).toHaveBeenCalledWith({ query: 'query Q { result }', variables: {} });
    });

    it('throws Error with graphqlErrors when result has errors', async () => {
      mockGraphql.mockResolvedValue({
        data: null,
        errors: [{ message: 'Unauthorized' }],
      });

      try {
        await service.query('query Q { result }');
        fail('Expected error');
      } catch (error: any) {
        expect(error.message).toBe('Unauthorized');
        expect(error.graphqlErrors).toEqual([{ message: 'Unauthorized' }]);
      }
    });

    it('does not throw when errors array is empty', async () => {
      mockGraphql.mockResolvedValue({ data: { ok: true }, errors: [] });

      const result = await service.query('query Q { ok }');
      expect(result).toEqual({ ok: true });
    });
  });

  describe('mutate', () => {
    it('calls graphql and returns data (same as query)', async () => {
      mockGraphql.mockResolvedValue({ data: { setGoal: { id: 'g1' } } });

      const result = await service.mutate('mutation M { setGoal { id } }', { input: {} });

      expect(mockGraphql).toHaveBeenCalledWith({
        query: 'mutation M { setGoal { id } }',
        variables: { input: {} },
      });
      expect(result).toEqual({ setGoal: { id: 'g1' } });
    });
  });

  describe('subscribe', () => {
    it('returns an Observable that wraps graphql subscription', () => {
      const mockUnsub = jest.fn();
      let capturedNext: any;
      mockGraphql.mockReturnValue({
        subscribe: (handlers: any) => {
          capturedNext = handlers.next;
          return { unsubscribe: mockUnsub };
        },
      });

      const values: any[] = [];
      const sub = service.subscribe('subscription S { onUpdate { id } }').subscribe({
        next: (v) => values.push(v),
      });

      capturedNext({ data: { onUpdate: { id: '1' } } });
      expect(values).toEqual([{ onUpdate: { id: '1' } }]);

      sub.unsubscribe();
      expect(mockUnsub).toHaveBeenCalled();
    });
  });

  describe('logout integration', () => {
    it('registers resetClient with LogoutOrchestrator on construction', () => {
      expect(mockRegister).toHaveBeenCalledWith(expect.any(Function));
    });

    it('resets client when LogoutOrchestrator callback is invoked', async () => {
      mockGraphql.mockResolvedValue({ data: {} });

      await service.query('q1');
      expect(mockGenerateClient).toHaveBeenCalledTimes(1);

      // Invoke the registered callback (simulates logout)
      const resetCallback = mockRegister.mock.calls[0][0];
      resetCallback();

      await service.query('q2');
      expect(mockGenerateClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('resetClient', () => {
    it('clears cached client so a new one is created', async () => {
      mockGraphql.mockResolvedValue({ data: {} });

      await service.query('q1');
      expect(mockGenerateClient).toHaveBeenCalledTimes(1);

      await service.query('q2');
      expect(mockGenerateClient).toHaveBeenCalledTimes(1);

      service.resetClient();
      await service.query('q3');
      expect(mockGenerateClient).toHaveBeenCalledTimes(2);
    });
  });
});
