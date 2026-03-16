import type { Bus } from '../../platform/bus';
import type { Middleware } from '../../internal';
import { publishErrorEvent } from '../publish-error-event';

export const withErrorPublishing = (bus: Bus, errorEventType: string): Middleware =>
  (fn) =>
    async (...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        await publishErrorEvent(bus, errorEventType, error);
        throw error;
      }
    };
