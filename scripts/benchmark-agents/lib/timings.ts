export function median(xs: readonly number[]): number {
  if (xs.length === 0) throw new Error('median of empty array');
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function asRate(num: number, denom: number): `${number}/${number}` {
  return `${num}/${denom}` as `${number}/${number}`;
}

export async function hrtimeMsAround<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T }> {
  const start = process.hrtime.bigint();
  const value = await fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1_000_000, value };
}
