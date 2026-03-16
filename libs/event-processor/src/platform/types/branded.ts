type Brand<K extends string> = { readonly __brand: K };

export type TenantId = string & Brand<'TenantId'>;
export type UserId = string & Brand<'UserId'>;
export type EventId = string & Brand<'EventId'>;

export const asTenantId = (s: string): TenantId => s as TenantId;
export const asUserId = (s: string): UserId => s as UserId;
export const asEventId = (s: string): EventId => s as EventId;
