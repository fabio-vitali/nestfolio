import type { Context } from 'aws-lambda';
import type { Bus } from '../../platform/bus';
import type { Middleware, LambdaHandler } from '../../internal';
import { publishErrorEvent } from '../publish-error-event';

export const withErrorPublishing = (bus: Bus, errorEventType: string): Middleware =>
  <R>(fn: LambdaHandler<R>): LambdaHandler<R> =>
    async (event: unknown, context?: Context) => {
      try {
        return await fn(event, context);
      } catch (error) {
        await publishErrorEvent(bus, errorEventType, error);
        throw error;
      }
    };
