import * as fs from "node:fs/promises";
import * as path from "node:path";

import express from "express";
import multer from "multer";

import { requireAuth, requireRole } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../env.js";
import { embedQuery } from "../../services/embeddings.js";
import { ingestDocument } from "../../services/ingestion.js";
import { deleteDocumentPoints, searchKnowledgeBase } from "../../services/qdrant.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

router.post(
  "/kb/:kbId/documents/upload",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  upload.single("file"),
  async (req, res) => {
    try {
      const kbId = Array.isArray(req.params.kbId) ? req.params.kbId[0] : req.params.kbId;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "Knowledge base not found" });
      }

      const filename = file.originalname;
      const mime = file.mimetype;

      const document = await prisma.document.create({
        data: {
          kbId,
          filename,
          mime,
          storagePath: "",
          status: "UPLOADED",
          createdById: req.user!.id,
        },
      });

      const uploadDir = path.join(
        env.STORAGE_DIR,
        "uploads",
        kbId,
        document.id,
      );
      await fs.mkdir(uploadDir, { recursive: true });

      const storagePath = path.join(uploadDir, filename);
      await fs.writeFile(storagePath, file.buffer);

      await prisma.document.update({
        where: { id: document.id },
        data: { storagePath },
      });

      setImmediate(() => {
        ingestDocument(document.id);
      });

      return res.status(201).json({
        documentId: document.id,
        status: "UPLOADED",
      });
    }
    catch (error) {
      console.error("Upload error:", error);
      return res.status(500).json({ message: "Upload failed" });
    }
  },
);

router.get(
  "/kb/:kbId/documents",
  requireAuth,
  async (req, res) => {
    try {
      const kbId = Array.isArray(req.params.kbId) ? req.params.kbId[0] : req.params.kbId;

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "Knowledge base not found" });
      }

      const documents = await prisma.document.findMany({
        where: { kbId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          mime: true,
          status: true,
          error: true,
          createdAt: true,
          createdBy: {
            select: {
              username: true,
            },
          },
        },
      });

      return res.json(documents);
    }
    catch (error) {
      console.error("List documents error:", error);
      return res.status(500).json({ message: "Failed to fetch documents" });
    }
  },
);

router.get(
  "/documents/:id",
  requireAuth,
  async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const document = await prisma.document.findUnique({
        where: { id },
        include: {
          kb: {
            select: {
              id: true,
              name: true,
            },
          },
          createdBy: {
            select: {
              username: true,
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      return res.json(document);
    }
    catch (error) {
      console.error("Get document error:", error);
      return res.status(500).json({ message: "Failed to fetch document" });
    }
  },
);

router.delete(
  "/documents/:id",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req, res) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      const document = await prisma.document.findUnique({
        where: { id },
      });

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      await deleteDocumentPoints(document.kbId, document.id);

      await prisma.document.delete({
        where: { id },
      });

      const documentDir = path.dirname(document.storagePath);
      try {
        await fs.rm(documentDir, { recursive: true, force: true });
      }
      catch (error) {
        console.error("Failed to delete storage directory:", error);
      }

      return res.json({ message: "Document deleted successfully" });
    }
    catch (error) {
      console.error("Delete document error:", error);
      return res.status(500).json({ message: "Failed to delete document" });
    }
  },
);

router.post(
  "/kb/:kbId/search",
  requireAuth,
  async (req, res) => {
    try {
      const kbId = Array.isArray(req.params.kbId) ? req.params.kbId[0] : req.params.kbId;
      const { query, topK = 5 } = req.body ?? {};

      if (typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ message: "Query is required" });
      }

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "Knowledge base not found" });
      }

      const queryVector = await embedQuery(query.trim());

      const results = await searchKnowledgeBase(
        kbId,
        queryVector,
        typeof topK === "number" ? topK : 5,
      );

      return res.json(results);
    }
    catch (error) {
      console.error("Search error:", error);
      const message = error instanceof Error ? error.message : "Search failed";
      return res.status(500).json({ message });
    }
  },
);

export default router;
