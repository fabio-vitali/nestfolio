import { applyMiddleware, type Middleware } from '../../src/middleware/apply-middleware';

describe('applyMiddleware', () => {
  const baseHandler = async (event: unknown) => `handled:${event}`;

  it('should return the handler unchanged when no middleware is provided', async () => {
    const wrapped = applyMiddleware(baseHandler);
    const result = await wrapped('test');
    expect(result).toBe('handled:test');
  });

  it('should apply a single middleware', async () => {
    const addPrefix: Middleware = (fn) => async (...args) => {
      const result = await fn(...args);
      return `[prefixed] ${result}`;
    };
    const wrapped = applyMiddleware(baseHandler, addPrefix);
    const result = await wrapped('test');
    expect(result).toBe('[prefixed] handled:test');
  });

  it('should apply middleware in declaration order (first declared = outermost)', async () => {
    const order: string[] = [];

    const mw1: Middleware = (fn) => async (...args) => {
      order.push('mw1-before');
      const result = await fn(...args);
      order.push('mw1-after');
      return result;
    };

    const mw2: Middleware = (fn) => async (...args) => {
      order.push('mw2-before');
      const result = await fn(...args);
      order.push('mw2-after');
      return result;
    };

    const wrapped = applyMiddleware(baseHandler, mw1, mw2);
    await wrapped('test');

    expect(order).toEqual(['mw1-before', 'mw2-before', 'mw2-after', 'mw1-after']);
  });

  it('should propagate errors through middleware stack', async () => {
    const throwingHandler = async () => {
      throw new Error('boom');
    };

    const catchingMw: Middleware = (fn) => async (...args) => {
      try {
        return await fn(...args);
      } catch {
        return 'caught' as unknown;
      }
    };

    const wrapped = applyMiddleware(throwingHandler, catchingMw);
    const result = await wrapped('test');
    expect(result).toBe('caught');
  });
});
