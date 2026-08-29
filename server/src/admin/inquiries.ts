import { db } from "../db/connection";

export type Inquiry = { id: number; userId: number; nickname: string; title: string; content: string; createdAt: number };

export function recordInquiry(userId: number, nickname: string, title: string, content: string): void {
  db.prepare(`INSERT INTO inquiries (user_id, nickname, title, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    userId,
    nickname,
    title,
    content,
    Date.now(),
  );
}

export function getInquiries(): Inquiry[] {
  return db
    .prepare(`SELECT id, user_id AS userId, nickname, title, content, created_at AS createdAt FROM inquiries ORDER BY id DESC`)
    .all() as Inquiry[];
}

export function _resetForTest(): void {
  db.prepare(`DELETE FROM inquiries`).run();
}
