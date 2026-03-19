import type { NextFunction, Request, Response } from "express";

import { verifyAccessToken } from "./jwt.js";

export type AuthUser = {
  id: string;
  role: "ADMIN" | "TEACHER";
};

declare global {
  // eslint-disable-next-line ts/consistent-type-definitions
  namespace Express {
    // eslint-disable-next-line ts/consistent-type-definitions
    interface Request {
      user?: AuthUser;
    }
  }
}

function parseBearer(header?: string): string | null {
  if (!header)
    return null;
  const [type, token] = header.split(" ");
  if (type !== "Bearer" || !token)
    return null;
  return token;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = parseBearer(req.header("authorization"));
    if (!token)
      return res.status(401).json({ message: "未登录" });

    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };

    return next();
  }
  catch {
    return res.status(401).json({ message: "登录已失效" });
  }
}

export function requireRole(roles: Array<AuthUser["role"]>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user)
      return res.status(401).json({ message: "未登录" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ message: "无权限" });
    return next();
  };
}
