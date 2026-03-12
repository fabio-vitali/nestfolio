import { util } from '@aws-appsync/utils';

export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  return { closureId: util.autoId(), status: 'REQUESTED', requestedAt: util.time.nowISO8601() };
}
