// todo: convert registry.ts from mini-rag to use an agent executing function that works with this repo setup

import { databaseSearchAgent } from "./databaseSearchAgent";
import { generalArtistInfoRagAgent } from "./generalArtistInfoRagAgent";
import { AgentType, AgentRequest, AgentResponse } from "./types";
import { unknownAgent } from "./unknownAgent";

type AgentExecutor = (request: AgentRequest) => Promise<AgentResponse>;

export const agentRegistry: Record<AgentType, AgentExecutor> = {
  databaseSearch: databaseSearchAgent,
  generalArtistInfoRag: generalArtistInfoRagAgent,
  unknown: unknownAgent,
};

export function getAgent(agentType: AgentType): AgentExecutor {
  const agent = agentRegistry[agentType];
  if (!agent) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  return agent;
}
