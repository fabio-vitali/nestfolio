export function handle(result: { userGoals?: unknown }) {
  if (!result.userGoals) throw new EmptyAgentResponseError('user-goals');
  return result.userGoals;
}
