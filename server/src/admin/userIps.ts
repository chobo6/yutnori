import { db } from "../db/connection";

export type UserIpEntry = { ip: string; firstSeen: string; lastSeen: string };

export function recordUserIp(userId: number, ip: string): void {
  if (ip === "unknown") return;
  db.prepare(
    `INSERT INTO user_ips (user_id, ip) VALUES (?, ?)
     ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = datetime('now', '+9 hours')`,
  ).run(userId, ip);
}

export function getIpsForUser(userId: number): UserIpEntry[] {
  const rows = db
    .prepare(`SELECT ip, first_seen, last_seen FROM user_ips WHERE user_id = ? ORDER BY last_seen DESC`)
    .all(userId) as { ip: string; first_seen: string; last_seen: string }[];
  return rows.map((r) => ({ ip: r.ip, firstSeen: r.first_seen, lastSeen: r.last_seen }));
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM user_ips`);
}
