import { END } from '@langchain/langgraph';
import { MAX_TURNS } from './state';

export function routeToPhase(state: { phase: string; turnCount?: number }): string {
  if (state.phase === 'completed') return END;
  if ((state.turnCount ?? 0) >= MAX_TURNS) return 'safety_cap_node';
  return `${state.phase}_node`;
}
