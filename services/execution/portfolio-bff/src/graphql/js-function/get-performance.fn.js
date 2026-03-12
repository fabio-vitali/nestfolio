export function request(ctx) {
  const period = ctx.arguments?.period || 'MONTH';
  return { payload: { period } };
}

export function response(ctx) {
  const period = ctx.result?.period || ctx.arguments?.period || 'MONTH';
  return {
    period,
    returnPercent: 0,
    returnAbsolute: 0,
    sharpeRatio: null,
    maxDrawdown: null,
  };
}
