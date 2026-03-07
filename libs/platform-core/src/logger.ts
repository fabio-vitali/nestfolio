import { Logger } from '@aws-lambda-powertools/logger';

/**
 * Shared logger instance — service name derived from Lambda function name.
 */
export const logger = new Logger({
  serviceName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
  logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
});

interface LogOptions {
  excludeArguments?: boolean;
  excludeResult?: boolean;
}

/**
 * Method decorator that logs method entry (with arguments) and exit (with result).
 * Handles both sync and async methods. Flattens Error objects for structured logging.
 */
export function log(options?: LogOptions) {
  return function (_target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      const className = this?.constructor?.name ?? 'Unknown';
      const methodName = `${className}.${propertyKey}`;

      const logArgs = options?.excludeArguments ? '[redacted]' : flattenArgs(args);
      logger.info(`${methodName} called`, { method: methodName, arguments: logArgs });

      try {
        const result = originalMethod.apply(this, args);

        // Handle async methods
        if (result instanceof Promise) {
          return result
            .then((resolved: unknown) => {
              const logResult = options?.excludeResult ? '[redacted]' : resolved;
              logger.info(`${methodName} returned`, { method: methodName, result: logResult });
              return resolved;
            })
            .catch((error: unknown) => {
              logger.error(`${methodName} threw`, {
                method: methodName,
                error: flattenError(error),
              });
              throw error;
            });
        }

        // Handle sync methods
        const logResult = options?.excludeResult ? '[redacted]' : result;
        logger.info(`${methodName} returned`, { method: methodName, result: logResult });
        return result;
      } catch (error) {
        logger.error(`${methodName} threw`, {
          method: methodName,
          error: flattenError(error),
        });
        throw error;
      }
    };

    return descriptor;
  };
}

function flattenArgs(args: unknown[]): unknown {
  return args.map((arg) => (arg instanceof Error ? flattenError(arg) : arg));
}

function flattenError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
