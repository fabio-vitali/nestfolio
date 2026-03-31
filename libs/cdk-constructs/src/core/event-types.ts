// libs/cdk-constructs/src/core/event-types.ts

// ── Type definitions ──────────────────────────────────────────────

export type FieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

export type Passthrough = {
  field: string;
  passthrough: true;
  emits: string[];
};

export type ActionMapping = string | FieldDispatch | Passthrough;

export type RecordTypeConfig =
  | string // base name → auto-expand to BASE_CREATED / BASE_UPDATED
  | { insert?: ActionMapping; modify?: ActionMapping; remove?: ActionMapping };

export type EventTypesMap = Record<string, RecordTypeConfig>;

// ── Runtime config types (serialized to EVENT_TYPE_MAP env var) ──

export type RuntimeFieldDispatch = {
  field: string;
  map: Record<string, string>;
  default?: string;
};

export type RuntimePassthrough = {
  field: string;
  passthrough: true;
};

export type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough;
export type RuntimeConfig = Record<string, RuntimeMapping>;

// ── Utility functions ─────────────────────────────────────────────

/**
 * Flatten EventTypesMap into `{RecordType}:{ACTION}` keyed runtime config.
 * Base name strings are expanded: 'FOO' → FOO_CREATED / FOO_UPDATED.
 */
export function buildRuntimeConfig(eventTypes: EventTypesMap): RuntimeConfig {
  const config: RuntimeConfig = {};

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    if (typeof recordConfig === 'string') {
      config[`${recordType}:INSERT`] = `${recordConfig}_CREATED`;
      config[`${recordType}:MODIFY`] = `${recordConfig}_UPDATED`;
    } else {
      for (const action of ['insert', 'modify', 'remove'] as const) {
        const mapping = recordConfig[action];
        if (!mapping) continue;
        const ddbAction = action.toUpperCase();
        if (typeof mapping === 'string') {
          config[`${recordType}:${ddbAction}`] = mapping;
        } else if ('passthrough' in mapping) {
          config[`${recordType}:${ddbAction}`] = { field: mapping.field, passthrough: true };
        } else {
          const entry: RuntimeFieldDispatch = { field: mapping.field, map: mapping.map };
          if (mapping.default) entry.default = mapping.default;
          config[`${recordType}:${ddbAction}`] = entry;
        }
      }
    }
  }

  return config;
}

/**
 * Collect every possible event type string the service can emit.
 */
export function collectAllEventTypes(eventTypes: EventTypesMap): string[] {
  const types: string[] = [];

  for (const recordConfig of Object.values(eventTypes)) {
    if (typeof recordConfig === 'string') {
      types.push(`${recordConfig}_CREATED`, `${recordConfig}_UPDATED`);
    } else {
      for (const mapping of [recordConfig.insert, recordConfig.modify, recordConfig.remove]) {
        if (!mapping) continue;
        if (typeof mapping === 'string') {
          types.push(mapping);
        } else if ('passthrough' in mapping) {
          types.push(...mapping.emits);
        } else {
          types.push(...Object.values(mapping.map));
          if (mapping.default) types.push(mapping.default);
        }
      }
    }
  }

  return [...new Set(types)];
}

/**
 * Extract DynamoDB Stream filter entries from the eventTypes map.
 * Returns one entry per record-type + action pair.
 */
export function extractFilters(
  eventTypes: EventTypesMap,
): Array<{ typeName: string; action: string }> {
  const filters: Array<{ typeName: string; action: string }> = [];

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    if (typeof recordConfig === 'string') {
      filters.push({ typeName: recordType, action: 'INSERT' });
      filters.push({ typeName: recordType, action: 'MODIFY' });
    } else {
      if (recordConfig.insert) filters.push({ typeName: recordType, action: 'INSERT' });
      if (recordConfig.modify) filters.push({ typeName: recordType, action: 'MODIFY' });
      if (recordConfig.remove) filters.push({ typeName: recordType, action: 'REMOVE' });
    }
  }

  return filters;
}
