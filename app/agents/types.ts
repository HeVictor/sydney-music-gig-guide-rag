import { z } from "zod";
import { StreamTextResult } from "ai";

export const agentTypeSchema = z
  .enum(["databaseSearch", "generalArtistInfoRag", "unknown"])
  .describe(
    "The agent to use: databaseSearch for looking up data for gigs in Sydney, generalArtistInfoRag for retrieving general information for music artists, and unknown if the request cannot be handled",
  );

export type AgentType = z.infer<typeof agentTypeSchema>;

export const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

export interface Source {
  title: string;
  url: string;
}

export interface AgentConfig {
  name: string;
  description: string;
}

export interface AgentRequest {
  type: AgentType;
  query: string; // Refined/summarized query from selector
  originalQuery: string; // Original user message
  messages: Message[]; // Conversation history
}

export type AgentResponse = {
  streamResult: StreamTextResult<Record<string, never>, never>;
  sources?: Source[];
};
