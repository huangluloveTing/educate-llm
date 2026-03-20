import { OpenAIEmbeddings } from "@langchain/openai";

import { env } from "../env.js";

let embeddings: OpenAIEmbeddings | null = null;

export function getEmbeddings(): OpenAIEmbeddings {
  if (!embeddings) {
    const apiKey = env.EMBED_API_KEY || env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error("Embedding API key not configured");
    }

    embeddings = new OpenAIEmbeddings({
      openAIApiKey: apiKey,
      configuration: {
        baseURL: env.EMBED_BASE_URL || env.LLM_BASE_URL,
      },
      model: env.EMBED_MODEL,
    });
  }
  return embeddings;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const embedder = getEmbeddings();
  return await embedder.embedDocuments(texts);
}

export async function embedQuery(query: string): Promise<number[]> {
  const embedder = getEmbeddings();
  return await embedder.embedQuery(query);
}
