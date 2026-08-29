import { db } from "../db/connection";

export type AdminEvent = {
  type: "join" | "leave" | "spectate_join" | "spectate_leave";
  timestamp: number;
  nickname: string;
  roomId: string;
  roomTitle: string;
  ip: string;
  sessionId: string;
};

const MAX_EVENTS = 500;

export function recordEvent(event: AdminEvent): void {
  db.prepare(
    `INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(event.type, event.timestamp, event.nickname, event.roomId, event.roomTitle, event.ip, event.sessionId);
}

export function getEvents(): AdminEvent[] {
  const rows = db
    .prepare(
      `SELECT type, timestamp, nickname, room_id AS roomId, room_title AS roomTitle, ip, session_id AS sessionId
       FROM events ORDER BY id DESC LIMIT ?`,
    )
    .all(MAX_EVENTS) as AdminEvent[];
  return rows.reverse();
}

export function searchEventsByNickname(nickname: string, limit = 200): AdminEvent[] {
  const escaped = nickname.replace(/[%_\\]/g, "\\$&");
  return db
    .prepare(
      `SELECT type, timestamp, nickname, room_id AS roomId, room_title AS roomTitle, ip, session_id AS sessionId
       FROM events WHERE nickname LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ?`,
    )
    .all(`%${escaped}%`, limit) as AdminEvent[];
}

export function _resetForTest(): void {
  db.prepare(`DELETE FROM events`).run();
}
