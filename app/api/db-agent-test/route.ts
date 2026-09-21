import { AgentAction } from "@/app/agents/agentTypes";
import { databaseSearchAgent } from "@/app/agents/databaseSearchAgent";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const dbAgentSchema = z.object({
  query: z.string(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = dbAgentSchema.parse(body);
  const { query } = parsed;

  const action: AgentAction = {
    action: "databaseSearch",
    agentQuery: query,
    originalQuery: query,
  };

  const message = await databaseSearchAgent(action);

  return NextResponse.json(
    {
      query,
      response: message,
    },
    { status: 200 },
  );
}
