import jwt from "jsonwebtoken";

import { env } from "../env.js";

export type JwtPayload = {
  sub: string;
  role: "ADMIN" | "TEACHER";
};

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: "7d",
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid token");
  }
  const sub = (decoded as any).sub;
  const role = (decoded as any).role;
  if (typeof sub !== "string" || (role !== "ADMIN" && role !== "TEACHER")) {
    throw new Error("Invalid token payload");
  }
  return { sub, role };
}
