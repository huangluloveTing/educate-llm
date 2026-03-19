import { OpenAIEmbeddings } from "@langchain/openai";

export async function createEmbeddings(): Promise<OpenAIEmbeddings> {
  // Get the embedding API configuration from environment variables
  const apiKey = process.env.EMBED_API_KEY || process.env.LLM_API_KEY || "";
  const baseUrl = process.env.EMBED_BASE_URL || process.env.LLM_BASE_URL;

  const embeddingsConfig: any = {
    apiKey,
  };

  // If we have a custom base URL, use it (for OpenAI-compatible APIs)
  if (baseUrl) {
    embeddingsConfig.baseUrl = baseUrl;
  }

  // Create and return the embeddings instance
  return new OpenAIEmbeddings(embeddingsConfig);
}