import { db } from "../db/connection";

export type DailyVisitStats = { today: number; recent: { date: string; count: number }[] };

export function recordVisit(userId: number): void {
  const today = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  recordVisitForDate(today.today, userId);
}

export function recordVisitForDate(date: string, userId: number): void {
  db.prepare(`INSERT OR IGNORE INTO daily_visit_log (date, visitor_key) VALUES (?, ?)`).run(date, `user:${userId}`);
  db.prepare(`DELETE FROM daily_visit_log WHERE date < date(?, '-90 days')`).run(date);
}

export function getDailyVisitStats(): DailyVisitStats {
  const todayRow = db.prepare(`SELECT date('now', '+9 hours') AS today`).get() as { today: string };
  const today = todayRow.today;

  const rows = db
    .prepare(`SELECT date, COUNT(*) AS count FROM daily_visit_log WHERE date >= date(?, '-6 days') GROUP BY date`)
    .all(today) as { date: string; count: number }[];
  const byDate = new Map(rows.map((r) => [r.date, r.count]));

  const recent: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dateRow = db.prepare(`SELECT date(?, '-' || ? || ' days') AS d`).get(today, i) as { d: string };
    recent.push({ date: dateRow.d, count: byDate.get(dateRow.d) ?? 0 });
  }

  return { today: byDate.get(today) ?? 0, recent };
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM daily_visit_log`);
}
