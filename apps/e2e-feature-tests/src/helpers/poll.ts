/** Poll an async producer until it returns a defined value, or throw on deadline. */
export async function poll<T>(
  fn: () => Promise<T | undefined>,
  deadlineMs: number,
  intervalMs = 3_000,
): Promise<T> {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    const v = await fn();
    if (v !== undefined) return v;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('poll timed out');
}
