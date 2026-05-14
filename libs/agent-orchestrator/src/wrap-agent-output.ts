/**
 * Runtime size guard for agent outputs flowing through Step Functions state.
 *
 * SF per-input limit is 32 KB; we cap inline at 25 KB to leave 7 KB headroom
 * for surrounding state structure (envelope fields, parallel results, etc.).
 *
 * Phase A: throws OutputTooLargeError if exceeded. Current p99 across 4
 * advisory agents is ~6 KB (4x headroom). If this ever fires in production,
 * file a follow-up to wire an S3-pointer fallback path.
 */
export const INLINE_SIZE_THRESHOLD_BYTES = 25_000;

export class OutputTooLargeError extends Error {
  constructor(public readonly actualBytes: number) {
    super(`Agent output (${actualBytes} bytes) exceeds ${INLINE_SIZE_THRESHOLD_BYTES} bytes inline threshold for SF state`);
    this.name = 'OutputTooLargeError';
  }
}

export type WrappedAgentOutput =
  | { kind: 'inline'; value: Record<string, unknown> };
// future: | { kind: 's3'; bucket: string; key: string };

export function wrapAgentOutput(output: Record<string, unknown>): WrappedAgentOutput {
  const serialized = JSON.stringify(output);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > INLINE_SIZE_THRESHOLD_BYTES) {
    throw new OutputTooLargeError(byteLength);
  }
  return { kind: 'inline', value: output };
}
