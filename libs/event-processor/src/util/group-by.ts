interface GroupByAll<T> { key: (item: T) => string; pick?: 'all' }
interface GroupByPick<T> { key: (item: T) => string; pick: 'first' | 'last' }

export function groupBy<T>(items: T[], config: GroupByPick<T>): Map<string, T>;
export function groupBy<T>(items: T[], config: GroupByAll<T>): Map<string, T[]>;
export function groupBy<T>(
  items: T[],
  config: { key: (item: T) => string; pick?: 'first' | 'last' | 'all' },
): Map<string, T | T[]> {
  const pick = config.pick ?? 'all';

  if (pick === 'all') {
    const map = new Map<string, T[]>();
    for (const item of items) {
      const k = config.key(item);
      const arr = map.get(k);
      if (arr) arr.push(item);
      else map.set(k, [item]);
    }
    return map;
  }

  const map = new Map<string, T>();
  if (pick === 'first') {
    for (const item of items) {
      const k = config.key(item);
      if (!map.has(k)) map.set(k, item);
    }
  } else {
    for (const item of items) {
      map.set(config.key(item), item);
    }
  }
  return map;
}
