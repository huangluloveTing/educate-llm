import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../env.js";

let client: QdrantClient | null = null;

export function getQdrantClient(): QdrantClient {
  if (!client) {
    client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
    });
  }
  return client;
}

export function getCollectionName(kbId: string): string {
  return `kb_${kbId}`;
}

export async function ensureCollection(kbId: string, vectorSize: number): Promise<void> {
  const client = getQdrantClient();
  const collectionName = getCollectionName(kbId);

  try {
    await client.getCollection(collectionName);
  }
  catch {
    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }
}

export async function deleteDocumentPoints(kbId: string, documentId: string): Promise<void> {
  const client = getQdrantClient();
  const collectionName = getCollectionName(kbId);

  try {
    await client.delete(collectionName, {
      filter: {
        must: [
          {
            key: "documentId",
            match: { value: documentId },
          },
        ],
      },
    });
  }
  catch (error) {
    console.error(`Failed to delete points for document ${documentId}:`, error);
  }
}

export interface SearchResult {
  score: number;
  text: string;
  filename: string;
  documentId: string;
  chunkIndex: number;
}

export async function searchKnowledgeBase(
  kbId: string,
  queryVector: number[],
  topK: number = 5,
): Promise<SearchResult[]> {
  const client = getQdrantClient();
  const collectionName = getCollectionName(kbId);

  try {
    const results = await client.search(collectionName, {
      vector: queryVector,
      limit: topK,
      with_payload: true,
    });

    return results.map(result => ({
      score: result.score,
      text: (result.payload?.text as string) || "",
      filename: (result.payload?.filename as string) || "",
      documentId: (result.payload?.documentId as string) || "",
      chunkIndex: (result.payload?.chunkIndex as number) || 0,
    }));
  }
  catch (error) {
    console.error(`Failed to search knowledge base ${kbId}:`, error);
    return [];
  }
}
