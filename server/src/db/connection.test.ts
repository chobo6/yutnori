import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

  it("90일 지난 events 행은 DB를 다시 열 때(재시작 시) 삭제된다", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "yutnori-db-test-"));
    const dbFile = path.join(dir, "test.db");
    try {
      const db1 = createDb(dbFile);
      const old = Date.now() - 91 * 24 * 60 * 60 * 1000;
      db1
        .prepare(
          `INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("join", old, "닉네임", "room1", "방제목", "1.2.3.4", "sess1");
      db1.close();

      // DB를 다시 열면(서버 재시작과 동일한 시점) createDb()의 정리 쿼리가 다시 실행된다.
      const db2 = createDb(dbFile);
      const remaining = db2.prepare(`SELECT COUNT(*) AS c FROM events`).get() as { c: number };
      expect(remaining.c).toBe(0);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sqliteBool은 1을 true로, 0을 false로 바꾼다", () => {
    expect(sqliteBool(1)).toBe(true);
    expect(sqliteBool(0)).toBe(false);
  });
});
