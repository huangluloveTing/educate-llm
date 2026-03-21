import express from "express";

import { requireAuth } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";

const router = express.Router();

// List conversations for current user
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { createdById: req.user!.id },
      orderBy: { updatedAt: "desc" },
      include: {
        kb: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    });

    res.json(conversations);
  }
  catch (error) {
    console.error("List conversations error:", error);
    res.status(500).json({ message: "获取会话列表失败" });
  }
});

// Get single conversation with messages
router.get("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const conversation = await prisma.conversation.findFirst({
      where: { id, createdById: req.user!.id },
      include: {
        kb: { select: { id: true, name: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!conversation) {
      return res.status(404).json({ message: "会话不存在" });
    }

    res.json(conversation);
  }
  catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ message: "获取会话失败" });
  }
});

// Create conversation
router.post("/conversations", requireAuth, async (req, res) => {
  try {
    const { title, kbId, systemPrompt } = req.body;

    // Verify kb exists if provided
    if (kbId) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });
      if (!kb) {
        return res.status(400).json({ message: "知识库不存在" });
      }
    }

    const conversation = await prisma.conversation.create({
      data: {
        title: title || "新对话",
        kbId: kbId || null,
        systemPrompt: systemPrompt || null,
        createdById: req.user!.id,
      },
      include: {
        kb: { select: { id: true, name: true } },
      },
    });

    res.status(201).json(conversation);
  }
  catch (error) {
    console.error("Create conversation error:", error);
    res.status(500).json({ message: "创建会话失败" });
  }
});

// Update conversation
router.patch("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { title, kbId, systemPrompt } = req.body;

    // Check ownership
    const existing = await prisma.conversation.findFirst({
      where: { id, createdById: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "会话不存在" });
    }

    // Verify kb exists if provided
    if (kbId !== undefined && kbId !== null) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: kbId },
      });
      if (!kb) {
        return res.status(400).json({ message: "知识库不存在" });
      }
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(kbId !== undefined && { kbId }),
        ...(systemPrompt !== undefined && { systemPrompt }),
      },
      include: {
        kb: { select: { id: true, name: true } },
      },
    });

    res.json(conversation);
  }
  catch (error) {
    console.error("Update conversation error:", error);
    res.status(500).json({ message: "更新会话失败" });
  }
});

// Delete conversation
router.delete("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Check ownership
    const existing = await prisma.conversation.findFirst({
      where: { id, createdById: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "会话不存在" });
    }

    await prisma.conversation.delete({
      where: { id },
    });

    res.json({ message: "删除成功" });
  }
  catch (error) {
    console.error("Delete conversation error:", error);
    res.status(500).json({ message: "删除会话失败" });
  }
});

// Add message to conversation
router.post("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ message: "缺少角色或内容" });
    }

    // Check ownership
    const conversation = await prisma.conversation.findFirst({
      where: { id, createdById: req.user!.id },
    });

    if (!conversation) {
      return res.status(404).json({ message: "会话不存在" });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: id,
        role,
        content,
      },
    });

    // Update conversation timestamp
    await prisma.conversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    res.status(201).json(message);
  }
  catch (error) {
    console.error("Add message error:", error);
    res.status(500).json({ message: "添加消息失败" });
  }
});

export default router;