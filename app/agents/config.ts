import { AgentType, AgentConfig } from "./types";

export const agentConfigs: Record<AgentType, AgentConfig> = {
  databaseSearch: {
    name: "Database Search Agent",
    description:
      "For extracting search parameters from user queries to look up data for gigs in Sydney, and returning the results",
  },
  generalArtistInfoRag: {
    name: "General Artist Info Agent",
    description:
      "For handling user queries asking questions about general facts and information regarding music artists",
  },
  unknown: {
    name: "Unknown Agent fallback",
    description:
      "For explaining to users when their queries cannot be answered by one of the other existing agents, and will do its best to still try and answer the user's query",
  },
};
