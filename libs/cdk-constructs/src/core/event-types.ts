// libs/cdk-constructs/src/core/event-types.ts
import type { EventName } from '@nestfolio/event-types';

// ── Type definitions ──────────────────────────────────────────────

export type FieldDispatch = {
  field: string;
  map: Record<string, EventName>;
  default?: EventName;
};

export type Passthrough = {
  field: string;
  passthrough: true;
  emits: EventName[];
};

/**
 * Modify-action emission with optional producer-side field-diff fan-out.
 * `always` fires on any modify; `onFieldChange` fires additional semantic
 * events when specific fields differ between OldImage and NewImage.
 */
export type ModifyEmission = {
  always?: EventName;
  onFieldChange?: Record<string, EventName>;
};

export type ActionMapping = EventName | FieldDispatch | Passthrough | ModifyEmission;

export type RecordTypeConfig = {
  insert?: ActionMapping;
  modify?: ActionMapping;
  remove?: ActionMapping;
};

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

export type RuntimeModifyEmission = {
  always?: string;
  onFieldChange?: Record<string, string>;
};

export type RuntimeMapping = string | RuntimeFieldDispatch | RuntimePassthrough | RuntimeModifyEmission;
export type RuntimeConfig = Record<string, RuntimeMapping>;

// ── Utility functions ─────────────────────────────────────────────

/**
 * Flatten EventTypesMap into `{RecordType}:{ACTION}` keyed runtime config.
 * Every mapping must be explicit — no auto-expand.
 */
export function buildRuntimeConfig(eventTypes: EventTypesMap): RuntimeConfig {
  const config: RuntimeConfig = {};

  for (const [recordType, recordConfig] of Object.entries(eventTypes)) {
    for (const action of ['insert', 'modify', 'remove'] as const) {
      const mapping = recordConfig[action];
      if (!mapping) continue;
      const ddbAction = action.toUpperCase();
      if (typeof mapping === 'string') {
        config[`${recordType}:${ddbAction}`] = mapping;
      } else if ('passthrough' in mapping) {
        config[`${recordType}:${ddbAction}`] = { field: mapping.field, passthrough: true };
      } else if ('always' in mapping || 'onFieldChange' in mapping) {
        const modEmit = mapping as ModifyEmission;
        const entry: RuntimeModifyEmission = {};
        if (modEmit.always) entry.always = modEmit.always;
        if (modEmit.onFieldChange) entry.onFieldChange = modEmit.onFieldChange as Record<string, string>;
        config[`${recordType}:${ddbAction}`] = entry;
      } else {
        const fd = mapping as FieldDispatch;
        const entry: RuntimeFieldDispatch = { field: fd.field, map: fd.map as Record<string, string> };
        if (fd.default) entry.default = fd.default as string;
        config[`${recordType}:${ddbAction}`] = entry;
      }
    }
  }

  return config;
}

/**
 * Collect every possible event type string the service can emit.
 */
export function collectAllEventTypes(eventTypes: EventTypesMap): EventName[] {
  const types: EventName[] = [];

  for (const recordConfig of Object.values(eventTypes)) {
    for (const mapping of [recordConfig.insert, recordConfig.modify, recordConfig.remove]) {
      if (!mapping) continue;
      if (typeof mapping === 'string') {
        types.push(mapping as EventName);
      } else if ('passthrough' in mapping) {
        types.push(...mapping.emits);
      } else if ('always' in mapping || 'onFieldChange' in mapping) {
        const modEmit = mapping as ModifyEmission;
        if (modEmit.always) types.push(modEmit.always);
        if (modEmit.onFieldChange) {
          types.push(...(Object.values(modEmit.onFieldChange) as EventName[]));
        }
      } else {
        const fd = mapping as FieldDispatch;
        types.push(...Object.values(fd.map));
        if (fd.default) types.push(fd.default);
      }
    }
  }

  return [...new Set(types)] as EventName[];
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
    if (recordConfig.insert) filters.push({ typeName: recordType, action: 'INSERT' });
    if (recordConfig.modify) filters.push({ typeName: recordType, action: 'MODIFY' });
    if (recordConfig.remove) filters.push({ typeName: recordType, action: 'REMOVE' });
  }

  return filters;
}
