import { log, logger } from '../src/logger';

describe('logger', () => {
  it('should be a Logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});

describe('@log() decorator', () => {
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(logger, 'info').mockImplementation();
    errorSpy = jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log method call and return for sync methods', () => {
    class TestService {
      @log()
      greet(name: string): string {
        return `Hello ${name}`;
      }
    }

    const service = new TestService();
    const result = service.greet('World');

    expect(result).toBe('Hello World');
    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.greet called',
      expect.objectContaining({ method: 'TestService.greet' }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.greet returned',
      expect.objectContaining({ method: 'TestService.greet', result: 'Hello World' }),
    );
  });

  it('should log method call and return for async methods', async () => {
    class TestService {
      @log()
      async fetchData(): Promise<number> {
        return 42;
      }
    }

    const service = new TestService();
    const result = await service.fetchData();

    expect(result).toBe(42);
    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.fetchData called',
      expect.anything(),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.fetchData returned',
      expect.objectContaining({ result: 42 }),
    );
  });

  it('should log errors for async methods that throw', async () => {
    class TestService {
      @log()
      async fail(): Promise<void> {
        throw new Error('boom');
      }
    }

    const service = new TestService();
    await expect(service.fail()).rejects.toThrow('boom');

    expect(errorSpy).toHaveBeenCalledWith(
      'TestService.fail threw',
      expect.objectContaining({
        error: expect.objectContaining({ name: 'Error', message: 'boom' }),
      }),
    );
  });

  it('should redact arguments when excludeArguments is true', () => {
    class TestService {
      @log({ excludeArguments: true })
      secret(password: string): string {
        return password;
      }
    }

    const service = new TestService();
    service.secret('s3cret');

    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.secret called',
      expect.objectContaining({ arguments: '[redacted]' }),
    );
  });

  it('should redact result when excludeResult is true', () => {
    class TestService {
      @log({ excludeResult: true })
      getToken(): string {
        return 'jwt-token';
      }
    }

    const service = new TestService();
    service.getToken();

    expect(infoSpy).toHaveBeenCalledWith(
      'TestService.getToken returned',
      expect.objectContaining({ result: '[redacted]' }),
    );
  });
});
