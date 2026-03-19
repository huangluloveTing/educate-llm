import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs/promises";
import { v4 as uuidv4 } from "uuid";
import { DocumentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma.js";
import { requireAuth, requireRole } from "../../auth/middleware.js";
import { env } from "../../env.js";

// Setup storage for uploads
const uploadDir = path.resolve(env.STORAGE_DIR);
await fs.mkdir(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Extract kbId from the request params
    const kbId = req.params.kbId;
    const uploadPath = path.join(uploadDir, "uploads", kbId);
    fs.mkdir(uploadPath, { recursive: true }).then(() => {
      cb(null, uploadPath);
    }).catch((err) => {
      cb(err, "");
    });
  },
  filename: function (req, file, cb) {
    // Generate unique filename to prevent conflicts
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

const router = express.Router();

// Upload document endpoint
router.post("/:kbId/documents/upload", requireAuth, requireRole(["ADMIN", "TEACHER"]), upload.single("file"), async (req, res) => {
  try {
    const { kbId } = req.params;

    // Verify knowledge base exists
    const kb = await prisma.knowledgeBase.findUnique({
      where: { id: kbId }
    });

    if (!kb) {
      return res.status(404).json({ message: "Knowledge base not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Create document record
    const document = await prisma.document.create({
      data: {
        kbId,
        filename: req.file.originalname,
        mime: req.file.mimetype,
        storagePath: req.file.path,
        createdById: req.user!.id,
        status: DocumentStatus.UPLOADED
      },
      select: {
        id: true,
        status: true
      }
    });

    // Trigger document processing
    processDocument(document.id).catch(console.error);

    res.json({
      documentId: document.id,
      status: document.status
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Process document (parses, chunks, and embeds)
async function processDocument(documentId: string) {
  try {
    // Get document info
    const document = await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.PARSING },
      select: {
        id: true,
        kbId: true,
        filename: true,
        storagePath: true,
        mime: true
      }
    });

    let textContent = "";

    // Parse file based on MIME type
    const ext = path.extname(document.storagePath).toLowerCase();

    if (ext === ".pdf" || document.mime === "application/pdf") {
      textContent = await parsePdf(document.storagePath);
    } else if (ext === ".docx" || document.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      textContent = await parseDocx(document.storagePath);
    } else if (ext === ".html" || ext === ".htm" || document.mime === "text/html") {
      textContent = await parseHtml(document.storagePath);
    } else if (ext === ".md" || ext === ".txt" || document.mime === "text/plain") {
      textContent = await fs.readFile(document.storagePath, "utf-8");
    } else {
      throw new Error(`Unsupported file type: ${document.mime}`);
    }

    // Update status to embedding
    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.EMBEDDING }
    });

    // Split content into chunks
    const chunks = await splitText(textContent);

    // Process chunks and create embeddings
    const embeddingsEnabled = process.env.EMBED_API_KEY || process.env.LLM_API_KEY;
    if (!embeddingsEnabled) {
      throw new Error("Embedding API key not configured");
    }

    // Import dynamically to avoid circular dependencies
    const { createEmbeddings } = await import("./embeddings.js");
    const embeddings = await createEmbeddings();

    // Get vector size by embedding a sample
    const sampleEmbedding = await embeddings.embedQuery("sample text");
    const vectorSize = sampleEmbedding.length;

    // Create or get collection in Qdrant
    const { createQdrantClient } = await import("./qdrant.js");
    const client = createQdrantClient();
    const collectionName = `kb_${document.kbId}`;

    try {
      await client.getCollection(collectionName);
    } catch {
      // Collection doesn't exist, create it
      await client.createCollection(collectionName, {
        vectors: {
          size: vectorSize,
          distance: "Cosine"
        }
      });
    }

    // Create embeddings for chunks
    const texts = chunks.map(chunk => chunk.text);
    const vectors = await embeddings.embedDocuments(texts);

    // Prepare points for insertion
    const points = chunks.map((chunk, index) => ({
      id: `${document.id}:${index}`,
      vector: vectors[index],
      payload: {
        kbId: document.kbId,
        documentId: document.id,
        filename: document.filename,
        chunkIndex: index,
        text: chunk.text
      }
    }));

    // Upsert points to Qdrant
    await client.upsert(collectionName, {
      wait: true,
      points
    });

    // Update document status to ready
    await prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.READY }
    });

  } catch (error: any) {
    console.error("Document processing error:", error);
    // Update document status to failed with error message
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.FAILED,
        error: error.message || "Unknown error occurred during processing"
      }
    });
  }
}

// Helper function to parse PDF
async function parsePdf(filePath: string): Promise<string> {
  // Dynamic import to avoid heavy dependencies unless needed
  const { parseBuffer } = await import("pdf-parse");
  const buffer = await fs.readFile(filePath);
  const data = await parseBuffer(buffer);
  return data.text;
}

// Helper function to parse DOCX
async function parseDocx(filePath: string): Promise<string> {
  // Dynamic import to avoid heavy dependencies unless needed
  const mammoth = await import("mammoth");
  const result = await mammoth.default.extractRawText({ path: filePath });
  return result.value;
}

// Helper function to parse HTML
async function parseHtml(filePath: string): Promise<string> {
  // Dynamic import to avoid heavy dependencies unless needed
  const cheerio = await import("cheerio");
  const html = await fs.readFile(filePath, "utf-8");
  const $ = cheerio.default.load(html);
  return $("body").text();
}

// Helper function to split text
async function splitText(text: string): Promise<Array<{ text: string, chunkIndex: number }>> {
  const { RecursiveCharacterTextSplitter } = await import("langchain/text_splitter");

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 150,
  });

  const chunks = await splitter.splitText(text);
  return chunks.map((chunk, index) => ({
    text: chunk,
    chunkIndex: index
  }));
}

// Get documents for a knowledge base
router.get("/:kbId/documents", requireAuth, async (req, res) => {
  try {
    const { kbId } = req.params;

    // Verify knowledge base exists and user has access
    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: kbId }
    });

    if (!kb) {
      return res.status(404).json({ message: "Knowledge base not found" });
    }

    const documents = await prisma.document.findMany({
      where: { kbId },
      select: {
        id: true,
        filename: true,
        status: true,
        error: true,
        createdAt: true,
        createdBy: {
          select: {
            username: true
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(documents);
  } catch (error: any) {
    console.error("Get documents error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Get document by ID
router.get("/:kbId/documents/:id", requireAuth, async (req, res) => {
  try {
    const { kbId, id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        kbId  // Ensure the document belongs to the specified knowledge base
      },
      select: {
        id: true,
        filename: true,
        status: true,
        error: true,
        storagePath: true,
        createdAt: true,
        updatedAt: true,
        kb: {
          select: {
            id: true,
            name: true
          }
        },
        createdBy: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    res.json(document);
  } catch (error: any) {
    console.error("Get document error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Delete document
router.delete("/:kbId/documents/:id", requireAuth, requireRole(["ADMIN", "TEACHER"]), async (req, res) => {
  try {
    const { kbId, id } = req.params;

    const document = await prisma.document.findFirst({
      where: {
        id,
        kbId  // Ensure the document belongs to the specified knowledge base
      },
      select: {
        id: true,
        storagePath: true,
        kbId: true
      }
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Delete from database first
    await prisma.document.delete({
      where: { id }
    });

    // Delete from Qdrant
    const { createQdrantClient } = await import("./qdrant.js");
    const client = createQdrantClient();
    const collectionName = `kb_${document.kbId}`;

    // Delete points with documentId filter
    await client.delete(collectionName, {
      wait: true,
      filter: {
        must: [{
          key: "documentId",
          match: {
            value: document.id
          }
        }]
      }
    });

    // Delete local file
    try {
      await fs.unlink(document.storagePath);
      // Try to delete parent directory if empty
      const dirPath = path.dirname(document.storagePath);
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        await fs.rmdir(dirPath);
      }
    } catch (error) {
      console.warn("Failed to delete local file:", error);
    }

    res.status(204).send();
  } catch (error: any) {
    console.error("Delete document error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

// Search in knowledge base
router.post("/:kbId/search", requireAuth, async (req, res) => {
  try {
    const { kbId } = req.params;
    const { query, topK = 5 } = req.body;

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({ message: "Query is required" });
    }

    // Verify knowledge base exists and user has access
    const kb = await prisma.knowledgeBase.findFirst({
      where: { id: kbId }
    });

    if (!kb) {
      return res.status(404).json({ message: "Knowledge base not found" });
    }

    // Import embeddings and qdrant client
    const { createEmbeddings } = await import("./embeddings.js");
    const embeddings = await createEmbeddings();

    const { createQdrantClient } = await import("./qdrant.js");
    const client = createQdrantClient();
    const collectionName = `kb_${kbId}`;

    // Create embedding for the query
    const queryEmbedding = await embeddings.embedQuery(query);

    // Search in Qdrant
    const searchResult = await client.search(collectionName, {
      vector: queryEmbedding,
      limit: Math.min(topK, 20), // Cap at 20 for safety
      with_payload: true,
      with_vector: false,
      filter: {
        must: [{
          key: "kbId",
          match: {
            value: kbId
          }
        }]
      }
    });

    // Format results
    const results = searchResult.map(hit => ({
      score: hit.score,
      text: hit.payload?.text as string,
      filename: hit.payload?.filename as string,
      documentId: hit.payload?.documentId as string,
      chunkIndex: hit.payload?.chunkIndex as number
    }));

    res.json(results);
  } catch (error: any) {
    console.error("Search error:", error);
    res.status(500).json({ message: error.message || "Internal server error" });
  }
});

export default router;