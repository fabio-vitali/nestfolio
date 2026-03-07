/**
 * Standard DynamoDB item shape used across all Nestfolio tables.
 * Every item has pk, sk, __typename, tenantId, and timestamp.
 */
export type TableEntry = {
  pk: string;
  sk: string;
  __typename: string;
  tenantId: string;
  timestamp: string;
  ttl?: number;
  [key: string]: unknown;
};
