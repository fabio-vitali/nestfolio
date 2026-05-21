export const util = {
  dynamodb: {
    toMapValues: (obj: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [
          k,
          typeof v === 'number'
            ? { N: String(v) }
            : v === null
              ? { NULL: true }
              : { S: String(v) },
        ]),
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
