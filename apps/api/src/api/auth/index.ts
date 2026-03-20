import bcrypt from "bcryptjs";
import express from "express";

import { signAccessToken } from "../../auth/jwt.js";
import { requireAuth } from "../../auth/middleware.js";
import { prisma } from "../../db/prisma.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ message: "参数错误" });
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user)
    return res.status(401).json({ message: "用户名或密码错误" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok)
    return res.status(401).json({ message: "用户名或密码错误" });

  const token = signAccessToken({ sub: user.id, role: user.role });

  return res.json({
    accessToken: token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user)
    return res.status(401).json({ message: "未登录" });
  return res.json({ id: user.id, username: user.username, role: user.role });
});

export default router;
