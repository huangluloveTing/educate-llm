import { createOpenAI } from "@ai-sdk/openai";

import { env } from "../env.js";

export function createAiSdkModel() {
  if (!env.LLM_API_KEY) {
    throw new Error("LLM_API_KEY 未配置");
  }

  const openai = createOpenAI({
    apiKey: env.LLM_API_KEY,
    baseURL: env.LLM_BASE_URL,
  });

  // Use chat() for Chat Completions API (/v1/chat/completions)
  // instead of responses() API (/v1/responses)
  return openai.chat(env.LLM_MODEL);
}
