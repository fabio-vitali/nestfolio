import { NotRetryableError } from '@nestfolio/platform-core';

/**
 * Reads a required environment variable at handler init time.
 * Throws a NotRetryableError if the variable is missing or empty,
 * since a missing env var is a deployment/configuration bug that
 * retries cannot fix.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new NotRetryableError(
      `Missing required environment variable: ${name}`,
      { envVar: name },
    );
  }
  return value;
}
