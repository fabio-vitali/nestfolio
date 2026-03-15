import { asyncPool } from './async-pool';

const DEFAULT_CONCURRENCY = 5;

export interface Branch<T, R> {
  filter: (item: T) => boolean;
  process: (item: T) => Promise<R>;
  concurrency?: number;
}

export interface BranchResult<R> {
  results: R[];
  errors: Array<{ item: unknown; error: Error }>;
}

export async function forkMerge<T, R>(
  items: T[],
  branches: Branch<T, R>[],
): Promise<BranchResult<R>[]> {
  const branchPromises = branches.map(async (branch): Promise<BranchResult<R>> => {
    const filtered = items.filter(branch.filter);
    const results: R[] = [];
    const errors: Array<{ item: unknown; error: Error }> = [];

    await asyncPool(
      filtered,
      async (item) => {
        try {
          results.push(await branch.process(item));
        } catch (err) {
          errors.push({ item, error: err instanceof Error ? err : new Error(String(err)) });
        }
      },
      { concurrency: branch.concurrency ?? DEFAULT_CONCURRENCY },
    );

    return { results, errors };
  });

  return Promise.all(branchPromises);
}
