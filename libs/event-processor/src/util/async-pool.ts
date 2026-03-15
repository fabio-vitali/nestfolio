import pLimit from 'p-limit';

const DEFAULT_CONCURRENCY = 5;

export async function asyncPool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  opts?: { concurrency?: number },
): Promise<R[]> {
  const limit = pLimit(opts?.concurrency ?? DEFAULT_CONCURRENCY);
  return Promise.all(items.map((item) => limit(() => fn(item))));
}
