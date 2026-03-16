import { logger } from '../../internal';

export const withMethodLogging = (className: string) =>
  <A extends unknown[], R>(
    methodName: string,
    fn: (...args: A) => Promise<R>,
  ): ((...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      logger.debug(`${className}.${methodName} called`, { args: summarizeArgs(args) });
      try {
        const result = await fn(...args);
        logger.debug(`${className}.${methodName} completed`);
        return result;
      } catch (error) {
        logger.error(`${className}.${methodName} failed`, {
          error: error instanceof Error
            ? { name: error.name, message: error.message }
            : { message: String(error) },
        });
        throw error;
      }
    };

function summarizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string' && arg.length > 100) return arg.slice(0, 100) + '...';
    if (typeof arg === 'object' && arg !== null) return '[object]';
    return arg;
  });
}
