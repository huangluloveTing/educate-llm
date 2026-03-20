import express from "express";

import { requireAuth, requireRole } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";

const router = express.Router();

router.get("/kb", requireAuth, async (req, res) => {
  const items = await prisma.knowledgeBase.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, description: true },
  });
  res.json(items);
});

router.post("/kb", requireAuth, requireRole(["ADMIN"]), async (req, res) => {
  const { name, description } = req.body ?? {};
  if (typeof name !== "string" || name.trim().length === 0)
    return res.status(400).json({ message: "名称不能为空" });

  const kb = await prisma.knowledgeBase.create({
    data: {
      name: name.trim(),
      description: typeof description === "string" ? description : null,
    },
    select: { id: true, name: true, description: true },
  });

  res.status(201).json(kb);
});

export default router;
