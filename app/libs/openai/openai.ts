import OpenAI from "openai";
import { wrapOpenAI } from "langsmith/wrappers";

const baseClient = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY as string,
});

export const openaiClient = wrapOpenAI(baseClient);
