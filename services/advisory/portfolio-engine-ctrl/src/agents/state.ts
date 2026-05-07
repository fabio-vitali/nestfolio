import { Annotation } from '@langchain/langgraph';

type AgentOutput = Record<string, unknown> | undefined;
const lastValue = (_prev: AgentOutput, next: AgentOutput): AgentOutput => next;
const lastString = (_prev: string | undefined, next: string | undefined): string | undefined => next;

export const PortfolioEngineState = Annotation.Root({
  input: Annotation<string | undefined>({ reducer: lastString }),
  operatingMode: Annotation<string | undefined>({ reducer: lastString }),
  'portfolio-construction': Annotation<AgentOutput>({ reducer: lastValue }),
  'rebalance-planner': Annotation<AgentOutput>({ reducer: lastValue }),
});

export type PortfolioEngineStateType = typeof PortfolioEngineState.State;
