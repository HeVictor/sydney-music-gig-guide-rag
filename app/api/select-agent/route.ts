import { agentConfigs } from "@/app/agents/config";
import { agentTypeSchema, messageSchema } from "@/app/agents/types";
import { openaiClient } from "@/app/libs/openai";
import { NextRequest, NextResponse } from "next/server";
import { zodTextFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";

const selectAgentSchema = z.object({
  messages: z.array(messageSchema).min(1),
});

const agentSelectionSchema = z.object({
  agent: agentTypeSchema,
  query: z.string().describe("refined query without conversational fluff"),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = selectAgentSchema.parse(body);
    const { messages } = parsed;

    // Take last 5 messages for context
    const recentMessages = messages.slice(-5);

    // Build agent descriptions from config
    const agentDescriptions = Object.entries(agentConfigs)
      .map(([key, config]) => `- "${key}": ${config.description}`)
      .join("\n");

    const result = await openaiClient.responses.parse({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: `You are an agent router. You analyse user queries and choose the most appropriate agent based on user intent.
					If the queries do not match well with any of the available agents, respond with "unknown" for the agent but still forward on the query.

					Available agents:
					${agentDescriptions}
					
					The query should be a refined, clear version of what the user wants, removing conversational fluff. Here's some pre-processing that you should do on the original query:
          
          - Expand common abbreviations with respect to the context (e.g. "usa" to "United States of America", "uk" to "United Kingdom")
          - Handle and correct common typos in the query
          - Remove filler words that do not add meaningful context for the downstream agents (e.g. "cool", "well", "yeah", "um", "basically", "awesome", "like", "hello", "hi", "please", "thanks")
					`,
        },
        ...recentMessages,
      ],
      text: {
        format: zodTextFormat(agentSelectionSchema, "agent_selection"),
      },
    });

    const output = result.output_parsed;

    if (output?.agent && output?.query) {
      return NextResponse.json({
        agent: result.output_parsed?.agent,
        query: result.output_parsed?.query,
      });
    } else {
      return NextResponse.json({ agent: "unknown", query: "" });
    }
  } catch (error) {
    console.error("Error selecting agent:", error);
    return NextResponse.json(
      { error: "Failed to select agent" },
      { status: 500 },
    );
  }
}
