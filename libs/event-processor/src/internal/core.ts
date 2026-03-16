import { randomUUID } from 'node:crypto';

/**
 * Generates a new UUID v4 string.
 */
export function getUUID(): string {
  return randomUUID();
}

/**
 * Returns the current time as an ISO 8601 string.
 */
export function getTime(): string {
  return new Date().toISOString();
}
