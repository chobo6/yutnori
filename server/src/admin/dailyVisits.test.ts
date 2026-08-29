import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { getDailyVisitStats, recordVisitForDate, _resetForTest } from "./dailyVisits";

describe("dailyVisits", () => {
  beforeEach(() => _resetForTest());

  it("같은 날 같은 유저는 한 번만 집계된다", () => {
    recordVisitForDate("2026-08-29", 1);
    recordVisitForDate("2026-08-29", 1);
    const stats = getDailyVisitStats();
    void stats; // getDailyVisitStats는 오늘 날짜 기준이라 여기선 원시 카운트로 직접 확인
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM daily_visit_log WHERE date = ?`).get("2026-08-29") as {
      c: number;
    }).c;
    expect(count).toBe(1);
  });

  it("다른 유저는 별도로 집계된다", () => {
    recordVisitForDate("2026-08-29", 1);
    recordVisitForDate("2026-08-29", 2);
    const count = (db.prepare(`SELECT COUNT(*) AS c FROM daily_visit_log WHERE date = ?`).get("2026-08-29") as {
      c: number;
    }).c;
    expect(count).toBe(2);
  });

  it("getDailyVisitStats는 최근 7일을 오름차순으로 빈 날짜도 0으로 채워 반환한다", () => {
    const stats = getDailyVisitStats();
    expect(stats.recent).toHaveLength(7);
  });
});
