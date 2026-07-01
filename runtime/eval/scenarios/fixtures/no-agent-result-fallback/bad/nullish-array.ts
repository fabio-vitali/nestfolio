export function handle(result: { holdings?: unknown[] }) { return result.holdings ?? []; }
