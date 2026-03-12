import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return { payload: ctx.arguments.input };
}

export function response(ctx) {
  const input = ctx.arguments.input || {};
  return { step: input.questionId || 'unknown', answeredAt: util.time.nowISO8601() };
}
