/**
 * Test mock for `@aws-appsync/utils/dynamodb` JS resolver helpers.
 *
 * Implements just enough of the helper surface to assert resolver `request()`
 * shape in unit tests. The helpers return a literal object describing the
 * intended DDB operation; AppSync at runtime translates that into the wire
 * call. Tests inspect this object directly.
 */

export const batchGet = (args: {
  tables: Record<string, { keys: Array<Record<string, unknown>> }>;
}) => ({
  operation: 'BatchGetItem',
  tables: args.tables,
});

export const get = (args: { key: Record<string, unknown> }) => ({
  operation: 'GetItem',
  key: args.key,
});

export const put = (args: { key: Record<string, unknown>; item: Record<string, unknown> }) => ({
  operation: 'PutItem',
  key: args.key,
  attributeValues: args.item,
});

export const update = (args: {
  key: Record<string, unknown>;
  update: Record<string, unknown>;
  condition?: Record<string, unknown>;
}) => ({
  operation: 'UpdateItem',
  key: args.key,
  update: args.update,
  ...(args.condition ? { condition: args.condition } : {}),
});

export const remove = (args: { key: Record<string, unknown> }) => ({
  operation: 'DeleteItem',
  key: args.key,
});
