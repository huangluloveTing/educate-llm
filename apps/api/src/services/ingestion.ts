import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { v4 as uuidv4 } from "uuid";

import { prisma } from "../db/prisma.js";
import { embedTexts } from "./embeddings.js";
import { parseDocument } from "./parser.js";
import { ensureCollection, getCollectionName, getQdrantClient } from "./qdrant.js";

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 150,
});

export type Chunk = {
  text: string;
  chunkIndex: number;
};

export async function ingestDocument(documentId: string): Promise<void> {
  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: { kb: true },
    });

    if (!document) {
      throw new Error("Document not found");
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "PARSING" },
    });

    const text = await parseDocument(document.storagePath, document.mime);

    if (!text || text.trim().length === 0) {
      throw new Error("No text content extracted from document");
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "EMBEDDING" },
    });

    const chunks = await textSplitter.splitText(text);

    if (chunks.length === 0) {
      throw new Error("No chunks generated from document");
    }

    const vectors = await embedTexts(chunks);

    const vectorSize = vectors[0]?.length;
    if (!vectorSize) {
      throw new Error("Failed to generate embeddings");
    }

    await ensureCollection(document.kbId, vectorSize);

    const client = getQdrantClient();
    const collectionName = getCollectionName(document.kbId);

    const points = chunks.map((chunk, index) => ({
      id: uuidv4(), // Qdrant requires UUID or unsigned integer for point IDs
      vector: vectors[index],
      payload: {
        kbId: document.kbId,
        documentId,
        filename: document.filename,
        chunkIndex: index,
        text: chunk,
      },
    }));

    await client.upsert(collectionName, {
      wait: true,
      points,
    });

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "READY", error: null },
    });
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        error: errorMessage,
      },
    });
    console.error(`Document ingestion failed for ${documentId}:`, error);
  }
}
