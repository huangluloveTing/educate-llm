import { ChatOpenAI } from "@langchain/openai";

import { env } from "../env.js";

export function createChatModel() {
  if (!env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY 未配置");
  }

  return new ChatOpenAI({
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    temperature: 0.2,
    configuration: {
      baseURL: env.LLM_BASE_URL,
    },
  });
}
