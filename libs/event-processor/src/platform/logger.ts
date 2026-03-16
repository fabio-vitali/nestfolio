import { logger } from '../internal';

export { logger };

interface LogOptions {
  excludeArguments?: boolean;
  excludeResult?: boolean;
}

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
