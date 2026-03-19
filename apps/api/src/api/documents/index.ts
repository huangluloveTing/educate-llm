import * as fs from "node:fs/promises";
import * as path from "node:path";

import express from "express";
import multer from "multer";

import { requireAuth, requireRole } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../env.js";
import { embedQuery } from "../../services/embeddings.js";
import { ingestDocument } from "../../services/ingestion.js";
import { getMimeType } from "../../services/parser.js";
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
      const { kbId } = req.params;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ message: "未提供文件" });
      }

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "知识库不存在" });
      }

      const filename = file.originalname;
      const mime = getMimeType(filename);

      if (mime === "application/octet-stream") {
        return res.status(400).json({ message: "不支持的文件格式" });
      }

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
      return res.status(500).json({ message: "上传失败" });
    }
  },
);

router.get(
  "/kb/:kbId/documents",
  requireAuth,
  async (req, res) => {
    try {
      const { kbId } = req.params;

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "知识库不存在" });
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
      return res.status(500).json({ message: "获取文档列表失败" });
    }
  },
);

router.get(
  "/documents/:id",
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

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
        return res.status(404).json({ message: "文档不存在" });
      }

      return res.json(document);
    }
    catch (error) {
      console.error("Get document error:", error);
      return res.status(500).json({ message: "获取文档详情失败" });
    }
  },
);

router.delete(
  "/documents/:id",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const document = await prisma.document.findUnique({
        where: { id },
      });

      if (!document) {
        return res.status(404).json({ message: "文档不存在" });
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

      return res.json({ message: "删除成功" });
    }
    catch (error) {
      console.error("Delete document error:", error);
      return res.status(500).json({ message: "删除文档失败" });
    }
  },
);

router.post(
  "/kb/:kbId/search",
  requireAuth,
  async (req, res) => {
    try {
      const { kbId } = req.params;
      const { query, topK = 5 } = req.body ?? {};

      if (typeof query !== "string" || query.trim().length === 0) {
        return res.status(400).json({ message: "搜索关键词不能为空" });
      }

      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });

      if (!kb) {
        return res.status(404).json({ message: "知识库不存在" });
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
      const message = error instanceof Error ? error.message : "搜索失败";
      return res.status(500).json({ message });
    }
  },
);

export default router;
