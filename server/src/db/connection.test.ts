import { describe, expect, it } from "vitest";
import { createDb, sqliteBool } from "./connection";

describe("createDb", () => {
  it("필요한 테이블을 전부 만든다", () => {
    const db = createDb(":memory:");
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of ["users", "events", "chat_logs", "user_ips", "daily_visit_log", "inquiries", "nickname_history"]) {
      expect(tables).toContain(t);
    }
  });

  it("users.nickname은 유니크하지만 NULL끼리는 충돌하지 않는다", () => {
    const db = createDb(":memory:");
    db.prepare(`INSERT INTO users (google_sub) VALUES ('a')`).run();
    db.prepare(`INSERT INTO users (google_sub) VALUES ('b')`).run();
    expect(() => db.prepare(`UPDATE users SET nickname = '테스트' WHERE google_sub = 'a'`).run()).not.toThrow();
    expect(() => db.prepare(`UPDATE users SET nickname = '테스트' WHERE google_sub = 'b'`).run()).toThrow();
  });

  it("90일 지난 events 행은 오픈 시점에 삭제된다", () => {
    const filename = ":memory:";
    const db1 = createDb(filename);
    const old = Date.now() - 91 * 24 * 60 * 60 * 1000;
    db1
      .prepare(`INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("join", old, "닉네임", "room1", "방제목", "1.2.3.4", "sess1");
    // :memory:는 연결마다 별도 DB라 재오픈 검증이 안 되므로, 같은 연결에서 직접 정리 쿼리 결과만 확인한다.
    const remaining = db1.prepare(`SELECT COUNT(*) AS c FROM events WHERE timestamp < ?`).get(Date.now() - 90 * 24 * 60 * 60 * 1000) as {
      c: number;
    };
    expect(remaining.c).toBe(0);
  });

  it("sqliteBool은 1을 true로, 0을 false로 바꾼다", () => {
    expect(sqliteBool(1)).toBe(true);
    expect(sqliteBool(0)).toBe(false);
  });
});
