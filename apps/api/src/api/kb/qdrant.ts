import { QdrantClient } from "@qdrant/js-client-rest";

export function createQdrantClient(): QdrantClient {
  // Get the Qdrant configuration from environment variables
  const url = process.env.QDRANT_URL || "http://localhost:6333";

  // Initialize Qdrant client
  return new QdrantClient({
    url: url,
  });
}