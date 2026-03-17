import { Annotation } from '@langchain/langgraph';

type AgentOutput = Record<string, unknown> | undefined;
const lastValue = (_prev: AgentOutput, next: AgentOutput): AgentOutput => next;
const lastString = (_prev: string | undefined, next: string | undefined): string | undefined => next;

export const DecisionLifecycleState = Annotation.Root({
  input: Annotation<string | undefined>({ reducer: lastString }),
  'user-goals': Annotation<AgentOutput>({ reducer: lastValue }),
  'risk-assessment': Annotation<AgentOutput>({ reducer: lastValue }),
  'market-research': Annotation<AgentOutput>({ reducer: lastValue }),
  'portfolio-construction': Annotation<AgentOutput>({ reducer: lastValue }),
  'rebalance-planner': Annotation<AgentOutput>({ reducer: lastValue }),
  explainability: Annotation<AgentOutput>({ reducer: lastValue }),
});

export type DecisionLifecycleStateType = typeof DecisionLifecycleState.State;
