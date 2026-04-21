// Prompts are loaded as text imports so esbuild (via --loader:.txt=text)
// inlines them into the runtime bundle. Runtime filesystem access fails in
// the AgentCore container (the Dockerfile only copies bundle.js, not
// individual .txt files), so readFileSync-based loading crash-loops the
// container on startup.
import userGoals from './user-goals.txt';
import riskAssessment from './risk-assessment.txt';
import marketResearch from './market-research.txt';
import portfolioConstruction from './portfolio-construction.txt';
import rebalancePlanner from './rebalance-planner.txt';
import explainability from './explainability.txt';

const PROMPTS: Record<string, string> = {
  'user-goals': userGoals,
  'risk-assessment': riskAssessment,
  'market-research': marketResearch,
  'portfolio-construction': portfolioConstruction,
  'rebalance-planner': rebalancePlanner,
  explainability,
};

export function loadPrompt(agentType: string): string {
  const prompt = PROMPTS[agentType];
  if (!prompt) throw new Error(`Unknown prompt for agent type: ${agentType}`);
  return prompt;
}
