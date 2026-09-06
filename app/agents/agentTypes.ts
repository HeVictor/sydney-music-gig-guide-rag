export type AgentAction = {
  action: "databaseSearch" | "none";
  originalQuery: string;
  agentQuery: string;
};
