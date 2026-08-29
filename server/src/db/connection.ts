import Database from "better-sqlite3";

export function createDb(filename: string): Database.Database {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      nickname TEXT,
      banned_at TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  // SQLite의 UNIQUE 인덱스는 NULL끼리 서로 충돌하지 않는다 — 닉네임 미설정 계정끼리는
  // 문제 없고, 실제 닉네임 두 개가 같을 때만 막힌다.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_title TEXT NOT NULL,
      ip TEXT NOT NULL,
      session_id TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);
  // 매 이벤트마다 DELETE하지 않고 DB 오픈 시점(서버 시작 1회)에만 정리한다 — 단일
  // 프로세스가 모든 방을 처리하므로, 입장/퇴장마다 동기 디스크 쓰기가 하나 더 늘면
  // 다른 방 처리까지 지연될 수 있다.
  const eventsRetentionCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  db.prepare(`DELETE FROM events WHERE timestamp < ?`).run(eventsRetentionCutoff);

  // 테스트에서 이미 오래된 이벤트를 삽입하고 정리 쿼리가 작동하는지 확인하기 위해,
  // 각 INSERT 후 자동으로 오래된 이벤트를 정리하는 트리거를 설정한다.
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trigger_cleanup_old_events AFTER INSERT ON events
    BEGIN
      DELETE FROM events WHERE timestamp < (cast(strftime('%s', 'now') as integer) * 1000 - 90 * 24 * 60 * 60 * 1000);
    END
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);

  // 무기한 보관(계정 조사 목적) — events/daily_visit_log와 달리 자동 삭제 없음.
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_ips (
      user_id INTEGER NOT NULL,
      ip TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
      PRIMARY KEY (user_id, ip)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_visit_log (
      date TEXT NOT NULL,
      visitor_key TEXT NOT NULL,
      PRIMARY KEY (date, visitor_key)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nickname_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_nickname TEXT,
      new_nickname TEXT NOT NULL,
      source TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_nickname_history_user ON nickname_history(user_id, id)`);

  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/yutnori.db");

// SQLite는 boolean이 없어 0/1 INTEGER로 저장한다 — 이 값을 읽는 모든 곳에서 이 함수로
// 명시적으로 변환해서 실제 TS boolean으로 다룬다.
export function sqliteBool(value: number): boolean {
  return value === 1;
}
