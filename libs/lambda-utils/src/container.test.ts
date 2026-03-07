import { buildContainer } from './container';

describe('buildContainer', () => {
  it('should create an Awilix container', () => {
    const container = buildContainer();

    expect(container).toBeDefined();
    expect(typeof container.resolve).toBe('function');
    expect(typeof container.register).toBe('function');
    expect(typeof container.dispose).toBe('function');
  });

  it('should create independent containers on each call', () => {
    const container1 = buildContainer();
    const container2 = buildContainer();

    expect(container1).not.toBe(container2);
  });

  it('should support registering and resolving dependencies', () => {
    const { asValue } = require('awilix');
    const container = buildContainer();

    container.register({
      dbClient: asValue({ name: 'mock-db-client' }),
    });

    const resolved = container.resolve('dbClient');
    expect(resolved).toEqual({ name: 'mock-db-client' });
  });

  it('should throw when resolving unregistered dependencies (strict mode)', () => {
    const container = buildContainer();

    expect(() => container.resolve('nonExistent')).toThrow();
  });
});
