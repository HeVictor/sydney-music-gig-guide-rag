import { openai } from "@ai-sdk/openai";
import { AgentRequest, AgentResponse } from "./types";
import { streamText } from "ai";

// This is a fallback 'agent' handler that handles all requests that cannot be classified
// for handling by the other proper agents
export async function unknownAgent(
  request: AgentRequest,
): Promise<AgentResponse> {
  return {
    streamResult: streamText({
      model: openai("gpt-4o-mini"),
      system: `You are an AI assistant that does your best to handle general queries that could not be handled by other existing agents in the system. 

      You MUST preface all your responses with: 
      'Your query does not match one of our supported domains, therefore the quality of this response may vary, however we will still do our best to aswer it. 
      Our supported domains include writing LinkedIn posts and answering questions regarding technical documentation.'
      `,
      prompt: `
      Refined Query: ${request.query}
    `,
    }),
  };
}
