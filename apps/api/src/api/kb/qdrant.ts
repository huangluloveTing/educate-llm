import { QdrantClient } from "@qdrant/js-client-rest";

import { env } from "../../env.js";

export function createQdrantClient(): QdrantClient {
  return new QdrantClient({
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY || undefined,
  });
}
