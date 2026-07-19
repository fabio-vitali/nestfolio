import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { name, enabled, reason, eventTimestamp } = ctx.arguments;
  const now = util.time.nowISO8601();
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'FeatureFlag#SYSTEM',
      sk: `FeatureFlag#${name}`,
    }),
    attributeValues: util.dynamodb.toMapValues({
      __typename: 'FeatureFlag',
      name,
      enabled,
      reason: reason ?? null,
      updatedAt: now,
      // Monotonic guard: event-driven writes carry their emission timestamp;
      // manual/ops writes stamp server time so they outrank any earlier event.
      lastEventAt: eventTimestamp ?? now,
    }),
    // Broadcast events arrive at-least-once and reorderable — a BROKER_CIRCUIT_OPEN
    // delivered after a newer BROKER_CIRCUIT_CLOSED (or after a flag reset) must not
    // win. Strict < also makes duplicate redeliveries no-ops.
    ...(eventTimestamp
      ? {
          condition: {
            expression: 'attribute_not_exists(lastEventAt) OR lastEventAt < :et',
            expressionValues: util.dynamodb.toMapValues({ ':et': eventTimestamp }),
          },
        }
      : {}),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    name: ctx.result.name,
    enabled: ctx.result.enabled,
    reason: ctx.result.reason,
  };
}
