import { Annotation } from '@langchain/langgraph';

type AgentOutput = Record<string, unknown> | undefined;
const lastValue = (_prev: AgentOutput, next: AgentOutput): AgentOutput => next;
const lastString = (_prev: string | undefined, next: string | undefined): string | undefined => next;

export const InvestorProfileState = Annotation.Root({
  input: Annotation<string | undefined>({ reducer: lastString }),
  'user-goals': Annotation<AgentOutput>({ reducer: lastValue }),
  'risk-assessment': Annotation<AgentOutput>({ reducer: lastValue }),
});

export type InvestorProfileStateType = typeof InvestorProfileState.State;
