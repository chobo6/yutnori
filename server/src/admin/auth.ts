import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map<string, number>(); // token -> expiresAt

// 문자열 길이가 다르면 즉시 false를 반환하는 `===` 비교는 타이밍 공격에 이론상 노출된다.
// 두 값을 고정 길이 해시로 바꾼 뒤 timingSafeEqual로 비교하면 원본 길이 차이가 사라진다.
function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (typeof expected !== "string" || expected.length === 0) return false;
  return timingSafeEqual(sha256(password), sha256(expected));
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (typeof token !== "string") return false;
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (typeof token === "string") sessions.delete(token);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (!isValidSession(cookies?.admin_session)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function _resetForTest(): void {
  sessions.clear();
}
