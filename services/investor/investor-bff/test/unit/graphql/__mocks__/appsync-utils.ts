function toDynamoValue(v: unknown): unknown {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'boolean') return { BOOL: v };
  if (typeof v === 'string') return { S: v };
  if (Array.isArray(v)) return { L: v.map(toDynamoValue) };
  if (typeof v === 'object') {
    return {
      M: Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, toDynamoValue(val)]),
      ),
    };
  }
  return { S: String(v) };
}

export const util = {
  dynamodb: {
    toMapValues: (obj: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, toDynamoValue(v)]),
      ),
  },
  error: (message: string, type?: string) => {
    const e = new Error(message);
    (e as Error & { type?: string }).type = type;
    throw e;
  },
  time: { nowISO8601: () => '2026-04-22T00:00:00.000Z' },
  autoId: () => 'mock-auto-id',
  matches: (pattern: string, value: string) => new RegExp(pattern).test(value),
};
