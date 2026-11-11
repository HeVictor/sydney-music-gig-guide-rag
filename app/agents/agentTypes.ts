export type AgentAction = {
  action: "generalArtistInfoQuery" | "databaseSearch" | "none";
  originalQuery: string;
  agentQuery: string;
};
