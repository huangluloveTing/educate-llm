import { OpenAIEmbeddings } from "@langchain/openai";

import { env } from "../../env.js";

export function createEmbeddings(): OpenAIEmbeddings {
  const apiKey = env.EMBED_API_KEY || env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error("Embedding API key not configured");
  }

  return new OpenAIEmbeddings({
    openAIApiKey: apiKey,
    configuration: {
      baseURL: env.EMBED_BASE_URL || env.LLM_BASE_URL,
    },
    model: env.EMBED_MODEL,
  });
}
