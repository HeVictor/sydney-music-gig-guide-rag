import { z } from "zod";
import { agentTypeSchema, messageSchema } from "@/app/agents/types";
import { getAgent } from "@/app/agents/registry";

const chatSchema = z.object({
  messages: z.array(messageSchema),
  agent: agentTypeSchema,
  query: z.string(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = chatSchema.parse(body);
    const { messages, agent, query } = parsed;

    // Get original user query (last message)
    const lastMessage = messages[messages.length - 1];
    const originalQuery = lastMessage?.content || query;

    // Get the agent executor from registry
    const agentExecutor = getAgent(agent);

    // Execute agent and get streamed response
    const { streamResult, sources } = await agentExecutor({
      type: agent,
      query,
      originalQuery,
      messages,
    });

    const headers = new Headers();

    if (sources) {
      headers.set("X-Sources", encodeURIComponent(JSON.stringify(sources)));
    }

    return streamResult.toTextStreamResponse({ headers });
  } catch (error) {
    console.error("Error in chat API:", error);
    return new Response("Internal server error", { status: 500 });
  }
}

// todo: test this endpoint out and fix whatever needs to be fixed from the result
