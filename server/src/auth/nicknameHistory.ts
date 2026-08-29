import { db } from "../db/connection";

export type NicknameChangeSource = "initial" | "admin";

export function recordNicknameChange(
  userId: number,
  oldNickname: string | null,
  newNickname: string,
  source: NicknameChangeSource,
): void {
  db.prepare(
    `INSERT INTO nickname_history (user_id, old_nickname, new_nickname, source) VALUES (?, ?, ?, ?)`,
  ).run(userId, oldNickname, newNickname, source);
}

export type NicknameHistoryEntry = {
  oldNickname: string | null;
  newNickname: string;
  source: NicknameChangeSource;
  changedAt: string;
};

export function getNicknameHistory(userId: number): NicknameHistoryEntry[] {
  return db
    .prepare(
      `SELECT old_nickname AS oldNickname, new_nickname AS newNickname, source, changed_at AS changedAt
       FROM nickname_history WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId) as NicknameHistoryEntry[];
}
