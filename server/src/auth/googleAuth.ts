import { OAuth2Client } from "google-auth-library";
import { db } from "../db/connection";
import { sanitizeNickname } from "../game/nickname";
import { recordNicknameChange } from "./nicknameHistory";

let oauthClient: OAuth2Client | null = null;
function getOAuthClient(): OAuth2Client {
  if (!oauthClient) oauthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return oauthClient;
}

// Google ID 토큰(credential)을 검증해 { sub, email, name }을 반환한다.
// 검증 실패(서명/audience 불일치, 만료 등) 시 throw — 호출부(라우트)가 catch해서 401 처리.
export async function verifyGoogleIdToken(
  credential: string,
): Promise<{ sub: string; email?: string; name?: string }> {
  const audience = process.env.GOOGLE_CLIENT_ID;
  // audience가 undefined면 google-auth-library가 aud 클레임 검증 자체를 건너뛰어, 이 앱이
  // 아닌 다른 OAuth 클라이언트용으로 발급된 토큰도 통과해버린다 — 반드시 명시적으로 실패시킨다.
  if (!audience) throw new Error("GOOGLE_CLIENT_ID가 설정되지 않았습니다.");
  const client = getOAuthClient();
  const ticket = await client.verifyIdToken({ idToken: credential, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub) throw new Error("구글 토큰에 sub 클레임이 없습니다.");
  return { sub: payload.sub, email: payload.email, name: payload.name };
}

export type UserProfile = {
  id: number;
  nickname: string | null;
  bannedAt: string | null;
};

// googleSub 기준 조회 후 생성/갱신 — 로그인할 때마다(신규든 재로그인이든) 호출되므로
// last_login_at도 여기서 매번 갱신한다. 닉네임은 이 시점에 절대 건드리지 않는다
// (재로그인 시 구글 실명이 사용자가 정한 닉네임을 덮어쓰면 안 됨 — 신규 생성 시에만 NULL로 남음).
export function getOrCreateUser(googleSub: string, info: { email?: string; name?: string }): UserProfile {
  const existing = db.prepare(`SELECT id FROM users WHERE google_sub = ?`).get(googleSub) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE users SET email = COALESCE(?, email), name = COALESCE(?, name),
         last_login_at = datetime('now', '+9 hours') WHERE id = ?`,
    ).run(info.email ?? null, info.name ?? null, existing.id);
  } else {
    db.prepare(
      `INSERT INTO users (google_sub, email, name, last_login_at) VALUES (?, ?, ?, datetime('now', '+9 hours'))`,
    ).run(googleSub, info.email ?? null, info.name ?? null);
  }

  return getUserById(
    (db.prepare(`SELECT id FROM users WHERE google_sub = ?`).get(googleSub) as { id: number }).id,
  )!;
}

export type SetNicknameResult = "ok" | "already_set" | "taken";

export function setNickname(userId: number, nickname: string): SetNicknameResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  const result = db.prepare(`UPDATE users SET nickname = ? WHERE id = ? AND nickname IS NULL`).run(clean, userId);
  if (result.changes > 0) recordNicknameChange(userId, null, clean, "initial");
  return result.changes > 0 ? "ok" : "already_set";
}

export type AdminSetNicknameResult = "ok" | "taken";

// setNickname(최초 1회만)과 달리 이미 설정된 닉네임도 덮어쓴다 — 계정 수정이 이 함수의
// 존재 이유이기 때문. 유니크 제약은 그대로 적용된다.
export function adminSetNickname(userId: number, nickname: string): AdminSetNicknameResult {
  const clean = sanitizeNickname(nickname);
  const taken = db.prepare(`SELECT 1 FROM users WHERE nickname = ? AND id != ?`).get(clean, userId);
  if (taken) return "taken";
  const before = db.prepare(`SELECT nickname FROM users WHERE id = ?`).get(userId) as { nickname: string | null } | undefined;
  db.prepare(`UPDATE users SET nickname = ? WHERE id = ?`).run(clean, userId);
  recordNicknameChange(userId, before?.nickname ?? null, clean, "admin");
  return "ok";
}

export function getUserById(userId: number): UserProfile | undefined {
  return db
    .prepare(`SELECT id, nickname, banned_at AS bannedAt FROM users WHERE id = ?`)
    .get(userId) as UserProfile | undefined;
}

export function touchLastLogin(userId: number): void {
  db.prepare(`UPDATE users SET last_login_at = datetime('now', '+9 hours') WHERE id = ?`).run(userId);
}

export function setUserBanned(userId: number, banned: boolean): void {
  if (banned) {
    db.prepare(`UPDATE users SET banned_at = datetime('now', '+9 hours') WHERE id = ?`).run(userId);
  } else {
    db.prepare(`UPDATE users SET banned_at = NULL WHERE id = ?`).run(userId);
  }
}

export type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export function listUsers(
  offset: number,
  limit: number,
  nicknameQuery?: string,
): { rows: AdminUserRow[]; total: number } {
  const trimmed = nicknameQuery?.trim();
  const where = trimmed ? `WHERE nickname LIKE ?` : ``;
  const likeParam = trimmed ? [`%${trimmed}%`] : [];

  const rows = db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, created_at AS createdAt, last_login_at AS lastLoginAt
       FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...likeParam, limit, offset) as AdminUserRow[];
  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...likeParam) as { c: number }
  ).c;
  return { rows, total };
}
