import { createContainer, InjectionMode, type AwilixContainer } from 'awilix';

/**
 * Creates a pre-configured Awilix dependency injection container.
 * Uses CLASSIC injection mode (constructor parameter order matters)
 * and strict mode (throws on missing registrations).
 */
export function buildContainer(): AwilixContainer {
  return createContainer({
    injectionMode: InjectionMode.CLASSIC,
    strict: true,
  });
}
