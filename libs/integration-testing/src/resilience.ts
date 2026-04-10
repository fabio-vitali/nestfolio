import type { TableAssertions } from './fixtures/table-assertions';

const DYNAMIC_FIELDS = new Set([
  'pk', 'sk', 'tenantId', 'userId',
  'createdAt', 'updatedAt', 'timestamp', 'snapshotAt',
  'ttl', 'eventId', 'sourceEventId', 'sequenceNo', 'version',
]);

export function stripDynamicFields(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (!DYNAMIC_FIELDS.has(key)) clean[key] = value;
  }
  return clean;
}

export function sortSnapshot(
  items: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...items].sort((a, b) => {
    const keyA = `${a['__typename'] ?? ''}#${a['eventType'] ?? ''}`;
    const keyB = `${b['__typename'] ?? ''}#${b['eventType'] ?? ''}`;
    if (keyA !== keyB) return keyA.localeCompare(keyB);
    return stableStringify(a).localeCompare(stableStringify(b));
  });
}

export async function snapshotState(
  table: TableAssertions,
  service: string,
  pk: string,
  skPrefix?: string,
): Promise<Record<string, unknown>[]> {
  const items = await table.queryItems({ table: service, pk, skPrefix });
  return sortSnapshot(items.map(stripDynamicFields));
}

/**
 * Deterministic stringify — sorts object keys recursively so that two
 * structurally-equal objects produce identical strings regardless of
 * insertion order. Used by assertEquivalentState to compare snapshots
 * without depending on jest's expect() (this module lives in src/ which
 * does not have jest globals).
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${entries.join(',')}}`;
}

export function assertEquivalentState(
  snapshotA: Record<string, unknown>[],
  snapshotB: Record<string, unknown>[],
): void {
  const sortedA = sortSnapshot(snapshotA);
  const sortedB = sortSnapshot(snapshotB);
  const strA = stableStringify(sortedA);
  const strB = stableStringify(sortedB);
  if (strA !== strB) {
    throw new Error(
      `assertEquivalentState: snapshots differ\n` +
      `  A (${sortedA.length} items): ${strA}\n` +
      `  B (${sortedB.length} items): ${strB}`,
    );
  }
}

export async function countItems(
  table: TableAssertions,
  service: string,
  pk: string,
  skPrefix?: string,
): Promise<number> {
  const items = await table.queryItems({ table: service, pk, skPrefix });
  return items.length;
}
