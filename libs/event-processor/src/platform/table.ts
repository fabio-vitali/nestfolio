export type TableEntry = {
  pk: string;
  sk: string;
  __typename: string;
  tenantId: string;
  timestamp: string;
  ttl?: number;
  [key: string]: unknown;
};
