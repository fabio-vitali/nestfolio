import { createAgentNode, buildDecisionGraph, AGENT_TYPES, type AgentNodeMap } from '@nestfolio/agent-core';

const nodeMap: AgentNodeMap = {} as AgentNodeMap;
for (const type of AGENT_TYPES) {
  nodeMap[type] = createAgentNode(type);
}

export const graph = buildDecisionGraph(nodeMap);
