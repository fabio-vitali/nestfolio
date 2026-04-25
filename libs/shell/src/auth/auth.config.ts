/**
 * DI token + type for runtime auth configuration.
 * Pattern: abstract class as injection token (matches shape-frontends/libs/core/auth).
 *
 * Consumers: `inject(AuthConfig)` from inside a factory or constructor.
 * Provider: registered by the shell app with a `useFactory` reading
 * `getRuntimeConfig().auth` (charter §8 bootstrap discipline).
 */
export abstract class AuthConfig {
  abstract userPoolId: string;
  abstract clientId: string;
  abstract region: string;
}
