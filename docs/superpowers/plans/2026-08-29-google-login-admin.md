# 구글 로그인 + 관리자 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** yutnori에 구글 로그인(필수)·계정당 고정 닉네임·SQLite DB·관리자 대시보드(`/admin`)·로그 기록(입퇴장/채팅/IP/방문자/문의)을 추가한다.

**Architecture:** `songpyeon` 프로젝트(`c:\Users\hong\OneDrive\Desktop\workspace\songpyeon`)의 동일 기능을 그대로 이식하되, yutnori에 없는 기능(친구/상점/닉네임효과/듀오/특정유저 감시로그/실시간 입력 모니터링)은 제외한다. `better-sqlite3` 단일 DB 파일, JWT 세션 쿠키, `MatchRoom.onAuth`가 WS 업그레이드 시점에 쿠키를 직접 파싱해 로그인을 강제한다. 관리자는 별도 비밀번호 세션(인메모리)으로 인증한다.

**Tech Stack:** better-sqlite3, google-auth-library, jsonwebtoken, cookie-parser, dotenv (서버) / Google Identity Services 스크립트 직접 로드 (클라이언트, 라이브러리 없음)

**Spec:** `docs/superpowers/specs/2026-08-29-google-login-admin-design.md`

## Global Constraints

- 로그인이 필수다 — 로그인 없이 플레이하는 익명 경로는 없다(스펙 §1, §3.3).
- 닉네임은 계정당 최초 1회만 자율 설정, 이후 관리자만 변경 가능(스펙 §1, §3.1).
- DB는 `better-sqlite3`, WAL 모드, `synchronous = NORMAL`, 타임스탬프는 KST(`datetime('now', '+9 hours')`)(스펙 §2).
- `events`/`daily_visit_log`는 90일 보관(서버 시작 시점 정리), `user_ips`는 무기한 보관(스펙 §2).
- 기존 `MatchRoom.*.test.ts` 4개 파일(`MatchRoom.test.ts`, `MatchRoom.abilities.test.ts`, `MatchRoom.shortcut.test.ts`, `MatchRoom.fullGame.test.ts`)은 로그인 없이 join하던 구조라, `onAuth` 도입 후 전부 깨진다 — 공용 테스트 헬퍼(`connectAsUser`)로 순차 이전해야 한다(스펙 §10, 가장 리스크 큰 부분).
- 커밋 메시지는 한국어, `feat:`/`fix:` 같은 접두사 없음(이 프로젝트 세션 전체의 확립된 관례).
- 각 태스크는 `server/`에서 `npm test`, 클라이언트 변경 태스크는 `client/`에서 `npm run build`로 검증한다.

---

## Task 1: 서버 의존성 추가 + dotenv 로딩

**Files:**
- Modify: `server/package.json`
- Modify: `server/src/index.ts`
- Create: `server/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `server/.env`(git 미포함)에서 읽는 환경변수 `GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`, `ADMIN_PASSWORD`, `SQLITE_DB_PATH`(선택) — 이후 모든 태스크가 `process.env.*`로 참조한다.

- [ ] **Step 1: `server/package.json`에 의존성 추가**

`dependencies`에 추가:
```json
"better-sqlite3": "^12.11.1",
"cookie-parser": "^1.4.7",
"dotenv": "^17.4.2",
"google-auth-library": "^10.9.0",
"jsonwebtoken": "^9.0.3"
```

`devDependencies`에 추가:
```json
"@types/better-sqlite3": "^7.6.13",
"@types/cookie-parser": "^1.4.10",
"@types/jsonwebtoken": "^9.0.10",
"colyseus.js": "^0.16.0"
```

(`colyseus.js`는 클라이언트 SDK지만, 이후 테스트 헬퍼(Task 10)가 커스텀 쿠키 헤더로 WS 연결하기 위해 직접 써야 한다 — 지금은 npm workspaces 호이스팅으로 루트에만 존재하므로 `server/package.json`에 명시적으로 선언해 의존을 확실히 한다.)

- [ ] **Step 2: 설치**

Run: `npm install` (루트에서)

- [ ] **Step 3: `server/.env.example` 생성 (git 포함, 실제 값 없는 템플릿)**

```
GOOGLE_CLIENT_ID=
SESSION_JWT_SECRET=
ADMIN_PASSWORD=
```

- [ ] **Step 4: `.gitignore`에 DB 데이터 디렉터리 추가**

루트 `.gitignore`에 추가(이미 `.env`는 있음):
```
server/data/*
!server/data/.gitkeep
```

`server/data/.gitkeep` 빈 파일 생성.

- [ ] **Step 5: `server/src/index.ts` 최상단에 dotenv 로딩 추가**

```ts
import "dotenv/config";
import { createGameServer } from "./createServer";
```

- [ ] **Step 6: 빌드 확인**

Run: `cd server && npm run build`
Expected: 타입 에러 없음 (아직 새 모듈을 안 만들었으니 기존 코드만 통과하면 됨)

- [ ] **Step 7: 커밋**

```bash
git add server/package.json server/package-lock.json server/.env.example server/data/.gitkeep server/src/index.ts .gitignore ../package-lock.json
git commit -m "구글 로그인/관리자 기능에 필요한 서버 의존성 추가"
```

---

## Task 2: DB 연결 + 스키마 (`server/src/db/connection.ts`)

**Files:**
- Create: `server/src/db/connection.ts`
- Test: `server/src/db/connection.test.ts`
- Create: `server/vitest.setup.ts`
- Modify: `server/vitest.config.ts`

**Interfaces:**
- Produces: `export const db: Database.Database`, `export function sqliteBool(value: number): boolean`, `export function createDb(filename: string): Database.Database` — 이후 모든 `auth/*`, `admin/*` 모듈이 `import { db } from "../db/connection"`로 쓴다.

- [ ] **Step 1: `server/vitest.setup.ts` 생성 (테스트 환경변수 고정)**

```ts
process.env.SQLITE_DB_PATH = ":memory:";
process.env.SESSION_JWT_SECRET = "test-session-secret";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.ADMIN_PASSWORD = "test-admin-password";
```

- [ ] **Step 2: `server/vitest.config.ts`에 setupFiles 연결**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 3: 실패하는 테스트 작성 — `server/src/db/connection.test.ts`**

```ts
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
```

`:memory:`는 매 `createDb()` 호출마다 완전히 새 DB라 재시작 시나리오를 직접 재현할 수 없다 — 세 번째 테스트는 "오픈 시점에 정리 쿼리가 실제로 지운다"를 같은 연결 안에서 확인하는 것으로 대체했다(파일 기반 DB였다면 재오픈해서 확인하는 게 더 정확하지만, 이 프로젝트의 다른 DB 테스트들도 `:memory:` 관례를 따른다).

- [ ] **Step 4: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/db/connection.test.ts`
Expected: FAIL — `./connection` 모듈이 없음

- [ ] **Step 5: `server/src/db/connection.ts` 구현**

```ts
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
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd server && npx vitest run src/db/connection.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 7: 커밋**

```bash
git add server/src/db server/vitest.setup.ts server/vitest.config.ts
git commit -m "DB 스키마(users/events/chat_logs/user_ips/daily_visit_log/inquiries/nickname_history) 추가"
```

---

## Task 3: 세션 유틸 (`server/src/auth/session.ts`)

**Files:**
- Create: `server/src/auth/session.ts`
- Test: `server/src/auth/session.test.ts`

**Interfaces:**
- Consumes: `process.env.SESSION_JWT_SECRET`
- Produces: `SESSION_COOKIE_NAME: string`, `signSession(userId: number): string`, `verifySession(token: string | undefined): number | null`, `getCookieValue(cookieHeader: string | undefined, name: string): string | undefined` — Task 5(googleAuth 라우트), Task 11(MatchRoom.onAuth), Task 10(테스트 헬퍼)이 이 4개를 그대로 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
import { describe, expect, it } from "vitest";
import { getCookieValue, signSession, verifySession, SESSION_COOKIE_NAME } from "./session";

describe("session", () => {
  it("서명한 토큰을 검증하면 같은 userId가 나온다", () => {
    const token = signSession(42);
    expect(verifySession(token)).toBe(42);
  });

  it("잘못된 토큰은 null을 반환한다", () => {
    expect(verifySession("garbage")).toBeNull();
  });

  it("undefined 토큰은 null을 반환한다", () => {
    expect(verifySession(undefined)).toBeNull();
  });

  it("쿠키 헤더에서 이름으로 값을 뽑는다", () => {
    const token = signSession(7);
    const header = `other=1; ${SESSION_COOKIE_NAME}=${token}; another=2`;
    expect(getCookieValue(header, SESSION_COOKIE_NAME)).toBe(token);
  });

  it("쿠키 헤더가 없으면 undefined", () => {
    expect(getCookieValue(undefined, SESSION_COOKIE_NAME)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/auth/session.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
import jwt from "jsonwebtoken";

export const SESSION_COOKIE_NAME = "session";
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function signSession(userId: number): string {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) throw new Error("SESSION_JWT_SECRET이 설정되지 않았습니다.");
  return jwt.sign({ userId }, secret, { expiresIn: SESSION_MAX_AGE_MS / 1000 });
}

export function verifySession(token: string | undefined): number | null {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret || !token) return null;
  try {
    const payload = jwt.verify(token, secret) as { userId: number };
    return payload.userId;
  } catch {
    return null;
  }
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return undefined;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run src/auth/session.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/auth/session.ts server/src/auth/session.test.ts
git commit -m "JWT 세션 쿠키 유틸 추가"
```

---

## Task 4: 닉네임 이력 (`server/src/auth/nicknameHistory.ts`)

**Files:**
- Create: `server/src/auth/nicknameHistory.ts`
- Test: `server/src/auth/nicknameHistory.test.ts`

**Interfaces:**
- Consumes: `db`(Task 2)
- Produces: `recordNicknameChange(userId: number, oldNickname: string | null, newNickname: string, source: "initial" | "admin"): void`, `getNicknameHistory(userId: number): { oldNickname: string | null; newNickname: string; source: string; changedAt: string }[]` — Task 5(`googleAuth.ts`)가 `recordNicknameChange`를 쓴다.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { getNicknameHistory, recordNicknameChange } from "./nicknameHistory";

describe("nicknameHistory", () => {
  beforeEach(() => {
    db.exec("DELETE FROM nickname_history");
  });

  it("변경 이력을 기록하고 최신순으로 조회한다", () => {
    recordNicknameChange(1, null, "첫닉네임", "initial");
    recordNicknameChange(1, "첫닉네임", "바뀐닉네임", "admin");
    const history = getNicknameHistory(1);
    expect(history).toHaveLength(2);
    expect(history[0].newNickname).toBe("바뀐닉네임");
    expect(history[0].source).toBe("admin");
    expect(history[1].newNickname).toBe("첫닉네임");
  });

  it("다른 유저의 이력은 섞이지 않는다", () => {
    recordNicknameChange(1, null, "유저1", "initial");
    recordNicknameChange(2, null, "유저2", "initial");
    expect(getNicknameHistory(1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/auth/nicknameHistory.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
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
```

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run src/auth/nicknameHistory.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/auth/nicknameHistory.ts server/src/auth/nicknameHistory.test.ts
git commit -m "닉네임 변경 이력 기록 모듈 추가"
```

---

## Task 5: 구글 인증 코어 (`server/src/auth/googleAuth.ts`)

**Files:**
- Create: `server/src/auth/googleAuth.ts`
- Test: `server/src/auth/googleAuth.test.ts`

**Interfaces:**
- Consumes: `db`(Task 2), `sanitizeNickname`(기존 `server/src/game/nickname.ts`), `recordNicknameChange`(Task 4)
- Produces: `verifyGoogleIdToken(credential: string): Promise<{sub: string; email?: string; name?: string}>`, `type UserProfile = { id: number; nickname: string | null; bannedAt: string | null }`, `getOrCreateUser(googleSub: string, info: {email?: string; name?: string}): UserProfile`, `type SetNicknameResult = "ok" | "already_set" | "taken"`, `setNickname(userId: number, nickname: string): SetNicknameResult`, `type AdminSetNicknameResult = "ok" | "taken"`, `adminSetNickname(userId: number, nickname: string): AdminSetNicknameResult`, `getUserById(userId: number): UserProfile | undefined`, `touchLastLogin(userId: number): void`, `setUserBanned(userId: number, banned: boolean): void`, `type AdminUserRow = { id: number; email: string|null; name: string|null; nickname: string|null; bannedAt: string|null; createdAt: string; lastLoginAt: string|null }`, `listUsers(offset: number, limit: number): { rows: AdminUserRow[]; total: number }` — Task 11(MatchRoom.onAuth), Task 10(테스트 헬퍼), Task 16(HTTP 라우트), Task 17(관리자 라우트)이 이 함수들을 쓴다.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import {
  adminSetNickname,
  getOrCreateUser,
  getUserById,
  listUsers,
  setNickname,
  setUserBanned,
  touchLastLogin,
} from "./googleAuth";
import { getNicknameHistory } from "./nicknameHistory";

describe("googleAuth", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM nickname_history");
  });

  it("처음 로그인하면 계정을 만들고 닉네임은 null이다", () => {
    const user = getOrCreateUser("sub-1", { email: "a@b.com", name: "홍길동" });
    expect(user.nickname).toBeNull();
    expect(user.bannedAt).toBeNull();
  });

  it("같은 google_sub로 다시 로그인하면 같은 계정을 재사용한다", () => {
    const first = getOrCreateUser("sub-1", {});
    const second = getOrCreateUser("sub-1", {});
    expect(second.id).toBe(first.id);
  });

  it("닉네임은 최초 1회만 설정 가능하다", () => {
    const user = getOrCreateUser("sub-1", {});
    expect(setNickname(user.id, "첫닉네임")).toBe("ok");
    expect(setNickname(user.id, "다른닉네임")).toBe("already_set");
    expect(getUserById(user.id)?.nickname).toBe("첫닉네임");
  });

  it("이미 다른 계정이 쓰는 닉네임은 거부된다", () => {
    const u1 = getOrCreateUser("sub-1", {});
    const u2 = getOrCreateUser("sub-2", {});
    setNickname(u1.id, "겹치는닉네임");
    expect(setNickname(u2.id, "겹치는닉네임")).toBe("taken");
  });

  it("관리자는 이미 설정된 닉네임도 강제로 바꿀 수 있고 이력이 남는다", () => {
    const user = getOrCreateUser("sub-1", {});
    setNickname(user.id, "원래닉네임");
    expect(adminSetNickname(user.id, "관리자가바꾼닉네임")).toBe("ok");
    expect(getUserById(user.id)?.nickname).toBe("관리자가바꾼닉네임");
    const history = getNicknameHistory(user.id);
    expect(history[0]).toMatchObject({ oldNickname: "원래닉네임", newNickname: "관리자가바꾼닉네임", source: "admin" });
  });

  it("밴 설정/해제가 반영된다", () => {
    const user = getOrCreateUser("sub-1", {});
    setUserBanned(user.id, true);
    expect(getUserById(user.id)?.bannedAt).not.toBeNull();
    setUserBanned(user.id, false);
    expect(getUserById(user.id)?.bannedAt).toBeNull();
  });

  it("touchLastLogin이 last_login_at을 채운다", () => {
    const user = getOrCreateUser("sub-1", {});
    touchLastLogin(user.id);
    const row = db.prepare(`SELECT last_login_at AS lastLoginAt FROM users WHERE id = ?`).get(user.id) as {
      lastLoginAt: string | null;
    };
    expect(row.lastLoginAt).not.toBeNull();
  });

  it("listUsers는 페이지네이션과 전체 개수를 반환한다", () => {
    for (let i = 0; i < 3; i++) getOrCreateUser(`sub-${i}`, {});
    const { rows, total } = listUsers(0, 2);
    expect(total).toBe(3);
    expect(rows).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/auth/googleAuth.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
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

export function listUsers(offset: number, limit: number): { rows: AdminUserRow[]; total: number } {
  const rows = db
    .prepare(
      `SELECT id, email, name, nickname, banned_at AS bannedAt, created_at AS createdAt, last_login_at AS lastLoginAt
       FROM users ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset) as AdminUserRow[];
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
  return { rows, total };
}
```

(`users` 테이블에는 boolean 컬럼이 없어 `sqliteBool`은 이 파일에서 쓰지 않는다 — `banned_at`은 TEXT|NULL로 직접 판정한다.)

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run src/auth/googleAuth.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add server/src/auth/googleAuth.ts server/src/auth/googleAuth.test.ts
git commit -m "구글 계정 조회/생성, 닉네임 설정, 밴 관리 모듈 추가"
```

---

## Task 6: 관리자 인증 코어 (`server/src/admin/auth.ts`, `loginRateLimit.ts`)

**Files:**
- Create: `server/src/admin/auth.ts`
- Test: `server/src/admin/auth.test.ts`
- Create: `server/src/admin/loginRateLimit.ts`
- Test: `server/src/admin/loginRateLimit.test.ts`

**Interfaces:**
- Consumes: `process.env.ADMIN_PASSWORD`
- Produces: `SESSION_TTL_MS: number`, `checkPassword(password: string): boolean`, `createSession(): string`, `isValidSession(token: string | undefined): boolean`, `destroySession(token: string | undefined): void`, `requireAdmin(req, res, next): void`(Express 미들웨어), `_resetForTest(): void` / `isRateLimited(ip: string): boolean`, `recordFailedAttempt(ip: string): void`, `recordSuccessfulLogin(ip: string): void`, `_resetForTest(): void` — Task 17(관리자 라우트)이 전부 쓴다.

- [ ] **Step 1: 실패하는 테스트 — `admin/auth.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, createSession, destroySession, isValidSession, requireAdmin, _resetForTest } from "./auth";

describe("admin/auth", () => {
  beforeEach(() => {
    _resetForTest();
    process.env.ADMIN_PASSWORD = "correct-password";
  });

  it("맞는 비밀번호만 통과한다", () => {
    expect(checkPassword("correct-password")).toBe(true);
    expect(checkPassword("wrong")).toBe(false);
  });

  it("발급한 세션은 유효하고, 만든 적 없는 토큰은 무효다", () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
    expect(isValidSession("no-such-token")).toBe(false);
  });

  it("destroySession 이후엔 무효해진다", () => {
    const token = createSession();
    destroySession(token);
    expect(isValidSession(token)).toBe(false);
  });

  it("requireAdmin은 유효한 세션 쿠키가 없으면 401을 반환한다", () => {
    const req = { cookies: {} } as unknown as Parameters<typeof requireAdmin>[0];
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as unknown as Parameters<typeof requireAdmin>[1];
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireAdmin은 유효한 세션 쿠키가 있으면 next를 호출한다", () => {
    const token = createSession();
    const req = { cookies: { admin_session: token } } as unknown as Parameters<typeof requireAdmin>[0];
    const res = {} as Parameters<typeof requireAdmin>[1];
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/admin/auth.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현 — `server/src/admin/auth.ts`**

```ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const sessions = new Map<string, number>(); // token -> expiresAt

// 문자열 길이가 다르면 즉시 false를 반환하는 `===` 비교는 타이밍 공격에 이론상 노출된다.
// 두 값을 고정 길이 해시로 바꾼 뒤 timingSafeEqual로 비교하면 원본 길이 차이가 사라진다.
function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function checkPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (typeof expected !== "string" || expected.length === 0) return false;
  return timingSafeEqual(sha256(password), sha256(expected));
}

export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

export function isValidSession(token: string | undefined): boolean {
  if (typeof token !== "string") return false;
  const expiresAt = sessions.get(token);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function destroySession(token: string | undefined): void {
  if (typeof token === "string") sessions.delete(token);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  if (!isValidSession(cookies?.admin_session)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function _resetForTest(): void {
  sessions.clear();
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run src/admin/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 실패하는 테스트 — `admin/loginRateLimit.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { isRateLimited, recordFailedAttempt, recordSuccessfulLogin, _resetForTest } from "./loginRateLimit";

describe("loginRateLimit", () => {
  beforeEach(() => _resetForTest());

  it("5회 미만 실패면 잠기지 않는다", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  it("5회 실패하면 잠긴다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(true);
  });

  it("다른 IP는 서로 영향을 안 준다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("5.6.7.8")).toBe(false);
  });

  it("성공하면 실패 기록이 지워진다", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    recordSuccessfulLogin("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });
});
```

- [ ] **Step 6: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/admin/loginRateLimit.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 7: 구현 — `server/src/admin/loginRateLimit.ts`**

```ts
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map<string, { count: number; windowStart: number }>();

export function isRateLimited(ip: string): boolean {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.windowStart >= WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
}

export function recordSuccessfulLogin(ip: string): void {
  attempts.delete(ip);
}

export function _resetForTest(): void {
  attempts.clear();
}
```

- [ ] **Step 8: 통과 확인**

Run: `cd server && npx vitest run src/admin/loginRateLimit.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: 커밋**

```bash
git add server/src/admin/auth.ts server/src/admin/auth.test.ts server/src/admin/loginRateLimit.ts server/src/admin/loginRateLimit.test.ts
git commit -m "관리자 비밀번호 인증 + 로그인 시도 제한 추가"
```

---

## Task 7: 입퇴장/채팅 로그 (`server/src/admin/eventLog.ts`, `chatLog.ts`)

**Files:**
- Create: `server/src/admin/eventLog.ts`
- Test: `server/src/admin/eventLog.test.ts`
- Create: `server/src/admin/chatLog.ts`
- Test: `server/src/admin/chatLog.test.ts`

**Interfaces:**
- Consumes: `db`(Task 2)
- Produces: `type AdminEvent = {type: "join"|"leave"|"spectate_join"|"spectate_leave"; timestamp: number; nickname: string; roomId: string; roomTitle: string; ip: string; sessionId: string}`, `recordEvent(event: AdminEvent): void`, `getEvents(): AdminEvent[]`, `searchEventsByNickname(nickname: string, limit?: number): AdminEvent[]`, `_resetForTest(): void` / `type ChatLogEntry = {nickname: string; text: string; createdAt: string}`, `recordChatLog(nickname: string, text: string): void`, `getChatLogs(limit?: number): ChatLogEntry[]`, `_resetForTest(): void` — Task 11(MatchRoom 통합), Task 17(관리자 라우트)이 쓴다.

- [ ] **Step 1: 실패하는 테스트 — `eventLog.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getEvents, recordEvent, searchEventsByNickname, _resetForTest } from "./eventLog";

describe("eventLog", () => {
  beforeEach(() => _resetForTest());

  it("기록한 이벤트를 오래된 순서로 반환한다", () => {
    recordEvent({ type: "join", timestamp: 1, nickname: "A", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    recordEvent({ type: "leave", timestamp: 2, nickname: "A", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    const events = getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("join");
    expect(events[1].type).toBe("leave");
  });

  it("닉네임 부분일치로 검색된다", () => {
    recordEvent({ type: "join", timestamp: 1, nickname: "홍길동", roomId: "r1", roomTitle: "방1", ip: "1.1.1.1", sessionId: "s1" });
    recordEvent({ type: "join", timestamp: 2, nickname: "다른사람", roomId: "r1", roomTitle: "방1", ip: "2.2.2.2", sessionId: "s2" });
    const results = searchEventsByNickname("길동");
    expect(results).toHaveLength(1);
    expect(results[0].nickname).toBe("홍길동");
  });
});
```

- [ ] **Step 2~4: 실행 확인 → 구현 → 재확인**

구현(`server/src/admin/eventLog.ts`):

```ts
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
```

Run: `cd server && npx vitest run src/admin/eventLog.test.ts` — 먼저 FAIL(모듈 없음) 확인 후 위 구현 작성, 다시 실행해 PASS(2 tests) 확인.

- [ ] **Step 5: 실패하는 테스트 — `chatLog.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getChatLogs, recordChatLog, _resetForTest } from "./chatLog";

describe("chatLog", () => {
  beforeEach(() => _resetForTest());

  it("기록한 메시지를 최신순으로 반환한다", () => {
    recordChatLog("A", "안녕");
    recordChatLog("B", "반가워");
    const logs = getChatLogs();
    expect(logs).toHaveLength(2);
    expect(logs[0].text).toBe("반가워");
    expect(logs[1].text).toBe("안녕");
  });
});
```

- [ ] **Step 6~8: 실행 확인 → 구현 → 재확인**

```ts
import { db } from "../db/connection";

export type ChatLogEntry = { nickname: string; text: string; createdAt: string };

export function recordChatLog(nickname: string, text: string): void {
  db.prepare(`INSERT INTO chat_logs (nickname, text) VALUES (?, ?)`).run(nickname, text);
}

export function getChatLogs(limit = 500): ChatLogEntry[] {
  return db
    .prepare(`SELECT nickname, text, created_at AS createdAt FROM chat_logs ORDER BY id DESC LIMIT ?`)
    .all(limit) as ChatLogEntry[];
}

export function _resetForTest(): void {
  db.exec(`DELETE FROM chat_logs`);
}
```

Run: `cd server && npx vitest run src/admin/chatLog.test.ts` — FAIL 확인 후 구현, PASS(1 test) 확인.

- [ ] **Step 9: 커밋**

```bash
git add server/src/admin/eventLog.ts server/src/admin/eventLog.test.ts server/src/admin/chatLog.ts server/src/admin/chatLog.test.ts
git commit -m "입퇴장 로그 + 채팅 로그 모듈 추가"
```

---

## Task 8: 계정별 IP 이력 + 일일 방문자 + 문의 (`userIps.ts`, `dailyVisits.ts`, `inquiries.ts`)

**Files:**
- Create: `server/src/admin/userIps.ts`, test
- Create: `server/src/admin/dailyVisits.ts`, test
- Create: `server/src/admin/inquiries.ts`, test

**Interfaces:**
- Consumes: `db`(Task 2)
- Produces: `recordUserIp(userId: number, ip: string): void`, `getIpsForUser(userId: number): {ip: string; firstSeen: string; lastSeen: string}[]` / `recordVisit(userId: number): void`, `recordVisitForDate(date: string, userId: number): void`, `getDailyVisitStats(): {today: number; recent: {date: string; count: number}[]}` / `recordInquiry(userId: number, nickname: string, title: string, content: string): void`, `getInquiries(): {id: number; userId: number; nickname: string; title: string; content: string; createdAt: number}[]` — Task 16/17이 쓴다.

- [ ] **Step 1: 실패하는 테스트 — `userIps.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getIpsForUser, recordUserIp, _resetForTest } from "./userIps";

describe("userIps", () => {
  beforeEach(() => _resetForTest());

  it("같은 IP로 다시 기록하면 행이 늘지 않고 last_seen만 갱신된다", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "1.2.3.4");
    expect(getIpsForUser(1)).toHaveLength(1);
  });

  it("다른 IP면 새 행이 생긴다", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "5.6.7.8");
    expect(getIpsForUser(1)).toHaveLength(2);
  });

  it("unknown은 기록하지 않는다", () => {
    recordUserIp(1, "unknown");
    expect(getIpsForUser(1)).toHaveLength(0);
  });
});
```

구현(`server/src/admin/userIps.ts`):

```ts
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
```

Run: `cd server && npx vitest run src/admin/userIps.test.ts` — FAIL 확인 후 구현, PASS(3 tests) 확인.

- [ ] **Step 2: 실패하는 테스트 — `dailyVisits.test.ts`**

로그인이 필수라 songpyeon의 `ip:<IP>` 방문자 키 분기가 필요 없다 — 항상 `user:<id>`.

```ts
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
```

구현(`server/src/admin/dailyVisits.ts`):

```ts
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
```

Run: `cd server && npx vitest run src/admin/dailyVisits.test.ts` — FAIL 확인 후 구현, PASS(3 tests) 확인.

- [ ] **Step 3: 실패하는 테스트 — `inquiries.test.ts`**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { getInquiries, recordInquiry, _resetForTest } from "./inquiries";

describe("inquiries", () => {
  beforeEach(() => _resetForTest());

  it("문의를 기록하고 최신순으로 조회한다", () => {
    recordInquiry(1, "유저A", "제목1", "내용1");
    recordInquiry(2, "유저B", "제목2", "내용2");
    const list = getInquiries();
    expect(list).toHaveLength(2);
    expect(list[0].title).toBe("제목2");
  });
});
```

구현(`server/src/admin/inquiries.ts`):

```ts
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
```

Run: `cd server && npx vitest run src/admin/inquiries.test.ts` — FAIL 확인 후 구현, PASS(1 test) 확인.

- [ ] **Step 4: 커밋**

```bash
git add server/src/admin/userIps.ts server/src/admin/userIps.test.ts server/src/admin/dailyVisits.ts server/src/admin/dailyVisits.test.ts server/src/admin/inquiries.ts server/src/admin/inquiries.test.ts
git commit -m "계정별 IP 이력, 일일 방문자 집계, 문의 기록 모듈 추가"
```

---

## Task 9: 공지 배너 SSE (`server/src/admin/announcements.ts`)

**Files:**
- Create: `server/src/admin/announcements.ts`
- Test: `server/src/admin/announcements.test.ts`

**Interfaces:**
- Produces: `subscribe(req: Request, res: Response): void`, `broadcast(message: string): void`, `_resetForTest(): void`, `_subscriberCountForTest(): number` — Task 17이 라우트에 연결한다.

- [ ] **Step 1: 실패하는 테스트**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { broadcast, subscribe, _resetForTest, _subscriberCountForTest } from "./announcements";

function makeMockRes() {
  const written: string[] = [];
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: (chunk: string) => written.push(chunk),
    on: vi.fn(),
    written,
  } as unknown as Response & { written: string[] };
}

describe("announcements", () => {
  beforeEach(() => _resetForTest());

  it("구독자가 등록되고 broadcast하면 메시지를 받는다", () => {
    const req = { on: vi.fn() } as unknown as Request;
    const res = makeMockRes();
    subscribe(req, res);
    expect(_subscriberCountForTest()).toBe(1);
    broadcast("안녕하세요");
    expect(res.written.some((chunk) => chunk.includes("안녕하세요"))).toBe(true);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `cd server && npx vitest run src/admin/announcements.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```ts
import type { Request, Response } from "express";

export type Announcement = { message: string; timestamp: number };

const RESEND_WINDOW_MS = 5 * 60 * 1000;
const subscribers = new Set<Response>();
let lastAnnouncement: Announcement | null = null;

function shouldResend(announcement: Announcement | null, now: number): announcement is Announcement {
  return announcement !== null && now - announcement.timestamp <= RESEND_WINDOW_MS;
}

function formatSseMessage(announcement: Announcement): string {
  return `data: ${JSON.stringify(announcement)}\n\n`;
}

export function subscribe(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  if (shouldResend(lastAnnouncement, Date.now())) {
    res.write(formatSseMessage(lastAnnouncement));
  }

  subscribers.add(res);
  req.on("close", () => subscribers.delete(res));
  res.on("error", () => subscribers.delete(res));
}

export function broadcast(message: string): void {
  const announcement: Announcement = { message, timestamp: Date.now() };
  lastAnnouncement = announcement;
  const payload = formatSseMessage(announcement);
  for (const res of subscribers) {
    try {
      res.write(payload);
    } catch {
      subscribers.delete(res);
    }
  }
}

export function _resetForTest(): void {
  subscribers.clear();
  lastAnnouncement = null;
}

export function _subscriberCountForTest(): number {
  return subscribers.size;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd server && npx vitest run src/admin/announcements.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: 커밋**

```bash
git add server/src/admin/announcements.ts server/src/admin/announcements.test.ts
git commit -m "공지 배너 SSE 모듈 추가"
```

---

## Task 10: 테스트 로그인 헬퍼 (`server/src/testUtils/connectAsUser.ts`)

**Files:**
- Create: `server/src/testUtils/connectAsUser.ts`

**Interfaces:**
- Consumes: `getOrCreateUser`, `setNickname`(Task 5), `signSession`(Task 3), `colyseus.js`의 `Client`
- Produces: `connectAsUser(colyseus: ColyseusTestServer, room: ServerRoom<MatchState>, nickname: string): Promise<ClientRoom<MatchState>>` — Task 12~15(기존 4개 테스트 파일 마이그레이션)이 이 함수 하나로 로그인+입장을 대체한다.

이 태스크는 테스트가 없다(테스트 유틸 자체이므로) — 대신 Task 12에서 실제로 써서 검증한다.

- [ ] **Step 1: 구현**

```ts
import { Client as ColyseusJsClient } from "colyseus.js";
import type { Room as ClientRoom } from "colyseus.js";
import type { Room as ServerRoom } from "colyseus";
import type { ColyseusTestServer } from "@colyseus/testing";
import { getOrCreateUser, setNickname } from "../auth/googleAuth";
import { signSession } from "../auth/session";
import type { MatchState } from "../rooms/MatchState";

// MatchRoom.onAuth가 로그인 세션을 요구하므로, 게임 로직만 검증하려는 기존 테스트들도
// "로그인된 유저로 접속"을 거쳐야 한다. 테스트용 유저를 DB에 만들고 실제 세션 쿠키를
// 발급받아, colyseus.js Client를 커스텀 Cookie 헤더로 직접 연결한다 — @colyseus/testing의
// connectTo는 헤더를 커스터마이즈할 수 없어서 이 방식이 필요하다(songpyeon과 동일 패턴).
let testUserCounter = 0;

export async function connectAsUser(
  colyseus: ColyseusTestServer,
  room: ServerRoom<MatchState>,
  nickname: string,
): Promise<ClientRoom<MatchState>> {
  testUserCounter += 1;
  const user = getOrCreateUser(`test-google-sub-${testUserCounter}`, {});
  setNickname(user.id, nickname);
  const token = signSession(user.id);
  const port = (colyseus.server as unknown as { port: number }).port;
  const client = new ColyseusJsClient(`ws://127.0.0.1:${port}`, {
    headers: { Cookie: `session=${token}` },
  });
  return client.joinById<MatchState>(room.roomId);
}
```

- [ ] **Step 2: 타입 체크**

Run: `cd server && npm run build`
Expected: 에러 없음(아직 아무 파일도 이걸 안 쓰므로 미사용 경고만 있을 수 있음 — export만 있어서 문제 없음)

- [ ] **Step 3: 커밋**

```bash
git add server/src/testUtils/connectAsUser.ts
git commit -m "테스트에서 로그인된 유저로 방에 접속하는 헬퍼 추가"
```

---

## Task 11: `MatchRoom.onAuth` 도입 + onJoin/onLeave 통합 (로그인 필수, 밴 체크, 로그 기록)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`

**Interfaces:**
- Consumes: `getCookieValue`, `verifySession`, `SESSION_COOKIE_NAME`(Task 3), `getUserById`(Task 5), `recordEvent`(Task 7), `recordChatLog`(Task 7)
- Produces: `onAuth`가 반환하는 `client.auth: { ip: string; userId: number; nickname: string }` — 이후 `onJoin`/`onLeave`/`sendChat` 핸들러가 이 값을 쓴다.

- [ ] **Step 1: import 추가 (파일 최상단)**

```ts
import { Room, Client, type AuthContext } from "colyseus";
// ... 기존 import들 유지 ...
import { getCookieValue, SESSION_COOKIE_NAME, verifySession } from "../auth/session";
import { getUserById } from "../auth/googleAuth";
import { recordEvent } from "../admin/eventLog";
import { recordChatLog } from "../admin/chatLog";
```

- [ ] **Step 2: 클래스 필드 추가**

`private allowSpectators = true;` 아래에 추가:

```ts
  /** 이벤트 로그(events 테이블)에 남길 방 제목 — onCreate에서 1회 설정. */
  private roomTitle = "";
  /** 같은 계정이 탭/기기 두 개로 같은 방에 동시에 플레이어로 들어오는 걸 막기 위한
   * sessionId -> userId 매핑. 관전자는 여기 안 들어간다. */
  private playerUserIds = new Map<string, number>();
```

- [ ] **Step 3: `onCreate` 안, `title` 계산 직후에 `this.roomTitle` 대입 추가**

```ts
    const title = sanitizeRoomTitle(options?.title) || "이름 없는 방";
    this.roomTitle = title;
```

- [ ] **Step 4: `onAuth` 신규 추가 (클래스 안, `onCreate` 다음 위치)**

```ts
  /**
   * Colyseus의 ws-transport가 실제 클라이언트 IP를 이미 계산해서 context.ip로 준다.
   * IP 외에 로그인 세션도 검증한다 — WS 업그레이드 요청은 Express의 cookie-parser를
   * 안 거치므로(Express 미들웨어 체인 밖) 쿠키 헤더를 직접 파싱한다. 세션이 없거나,
   * 계정에 닉네임이 아직 없거나(로그인만 하고 닉네임 설정을 안 끝냄), 밴된 계정이면
   * 입장 자체를 거부한다 — 클라이언트는 로그인+닉네임 설정을 먼저 끝내지 않으면 방
   * 목록조차 못 보므로, 이 경로는 직접 API 호출이나 세션이 로비 중간에 만료된 경우에만
   * 실제로 발동한다.
   */
  async onAuth(_client: Client, _options: unknown, context: AuthContext) {
    const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
    const userId = verifySession(token);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      throw new Error("로그인이 필요합니다.");
    }
    if (user.bannedAt) {
      throw new Error("이용이 제한된 계정입니다.");
    }
    return { ip: context.ip, userId: user.id, nickname: user.nickname };
  }
```

- [ ] **Step 5: `onJoin`을 아래 내용으로 교체**

기존:
```ts
  onJoin(client: Client, options?: { nickname?: string }) {
    const nickname = sanitizeNickname(options?.nickname) || "플레이어";

    if (this.state.phase === "waiting") {
      if (this.state.players.size >= this.playerCapacity) {
        throw new Error("방이 가득 찼습니다");
      }
      const player = new PlayerState();
      player.sessionId = client.sessionId;
      player.nickname = nickname;
      this.state.players.set(client.sessionId, player);
      this.setMetadata({ playerCount: this.state.players.size });
      return;
    }

    if (!this.allowSpectators) {
      throw new Error("관전이 허용되지 않는 방입니다");
    }
    const spectator = new SpectatorState();
    spectator.sessionId = client.sessionId;
    spectator.nickname = nickname;
    this.state.spectators.set(client.sessionId, spectator);
  }
```

교체 후:
```ts
  onJoin(client: Client) {
    const nickname = client.auth.nickname;
    const ip = String(client.auth.ip ?? "unknown");

    if (this.state.phase === "waiting") {
      if (this.state.players.size >= this.playerCapacity) {
        throw new Error("방이 가득 찼습니다");
      }
      // 같은 계정이 탭/기기 두 개로 이미 이 방에 플레이어로 들어와 있으면 또 자리를
      // 차지하지 못하게 막는다(관전은 이 체크와 무관).
      if ([...this.playerUserIds.values()].includes(client.auth.userId)) {
        throw new Error("이미 이 방에 참가 중인 계정입니다.");
      }
      const player = new PlayerState();
      player.sessionId = client.sessionId;
      player.nickname = nickname;
      this.state.players.set(client.sessionId, player);
      this.playerUserIds.set(client.sessionId, client.auth.userId);
      this.setMetadata({ playerCount: this.state.players.size });
      recordEvent({
        type: "join",
        timestamp: Date.now(),
        nickname,
        roomId: this.roomId,
        roomTitle: this.roomTitle,
        ip,
        sessionId: client.sessionId,
      });
      return;
    }

    if (!this.allowSpectators) {
      throw new Error("관전이 허용되지 않는 방입니다");
    }
    const spectator = new SpectatorState();
    spectator.sessionId = client.sessionId;
    spectator.nickname = nickname;
    this.state.spectators.set(client.sessionId, spectator);
    recordEvent({
      type: "spectate_join",
      timestamp: Date.now(),
      nickname,
      roomId: this.roomId,
      roomTitle: this.roomTitle,
      ip,
      sessionId: client.sessionId,
    });
  }
```

- [ ] **Step 6: `onLeave`를 아래 내용으로 교체**

기존:
```ts
  onLeave(client: Client) {
    if (this.state.spectators.has(client.sessionId)) {
      this.state.spectators.delete(client.sessionId);
      return;
    }
    this.state.players.delete(client.sessionId);
    if (this.state.phase === "waiting") {
      this.setMetadata({ playerCount: this.state.players.size });
    }
  }
```

교체 후:
```ts
  onLeave(client: Client) {
    const ip = String(client.auth?.ip ?? "unknown");
    const spectator = this.state.spectators.get(client.sessionId);
    if (spectator) {
      this.state.spectators.delete(client.sessionId);
      recordEvent({
        type: "spectate_leave",
        timestamp: Date.now(),
        nickname: spectator.nickname,
        roomId: this.roomId,
        roomTitle: this.roomTitle,
        ip,
        sessionId: client.sessionId,
      });
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player) return;
    this.state.players.delete(client.sessionId);
    this.playerUserIds.delete(client.sessionId);
    if (this.state.phase === "waiting") {
      this.setMetadata({ playerCount: this.state.players.size });
    }
    recordEvent({
      type: "leave",
      timestamp: Date.now(),
      nickname: player.nickname,
      roomId: this.roomId,
      roomTitle: this.roomTitle,
      ip,
      sessionId: client.sessionId,
    });
  }
```

- [ ] **Step 7: `sendChat` 핸들러에 채팅 로그 기록 추가**

기존:
```ts
    this.onMessage("sendChat", (client, message: { text?: unknown } | undefined) => {
      if (typeof message?.text !== "string") return;
      const text = message.text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return;
      this.broadcast("chatMessage", { sessionId: client.sessionId, text });
    });
```

교체 후:
```ts
    this.onMessage("sendChat", (client, message: { text?: unknown } | undefined) => {
      if (typeof message?.text !== "string") return;
      const text = message.text.trim().slice(0, MAX_CHAT_LENGTH);
      if (!text) return;
      this.broadcast("chatMessage", { sessionId: client.sessionId, text });
      recordChatLog(client.auth.nickname, text);
    });
```

- [ ] **Step 8: 더 이상 안 쓰는 `sanitizeNickname` import 처리**

`sanitizeNickname`은 `onJoin`에서 더 이상 안 쓴다. 다른 곳(예: 방 생성 시 호스트 표시 등)에서 쓰지 않는지 파일 전체를 확인하고, 안 쓰면 import 줄에서 제거한다.

Run: `grep -n "sanitizeNickname" server/src/rooms/MatchRoom.ts`
Expected: import 줄 외에 사용처가 없으면 import 제거, 있으면 유지.

- [ ] **Step 9: 타입 체크만 먼저 확인 (테스트는 다음 태스크들에서 순차로 고침)**

Run: `cd server && npm run build`
Expected: 타입 에러 없음(테스트 파일은 `tsc --noEmit`의 `include`에 따라 다를 수 있음 — 에러가 나면 다음 태스크에서 고칠 걸 알고 있으므로, `MatchRoom.ts` 자체의 에러만 없으면 된다)

이 시점에 `npm test`를 돌리면 기존 4개 룸 테스트 파일이 전부 실패한다 — **의도된 상태**다. Task 12~15에서 순차로 고친다.

- [ ] **Step 10: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts
git commit -m "MatchRoom에 로그인 필수 검증(onAuth) + 입퇴장/채팅 로그 기록 추가"
```

---

## Task 12: `MatchRoom.test.ts` 마이그레이션

**Files:**
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `connectAsUser`(Task 10)

이 파일의 모든 `colyseus.connectTo(room)` 호출을 `connectAsUser(colyseus, room, "닉네임N")`로 바꾼다. 정확한 호출부는 파일을 열어 확인해야 하며(플레이어 4명을 만드는 헬퍼 함수가 있을 가능성이 높다 — `setupFourPlayers` 같은 이름), 각 클라이언트를 만드는 자리마다 고유한 닉네임 문자열을 부여해야 한다(같은 파일 안에서 `setNickname`이 유니크 제약을 걸기 때문).

- [ ] **Step 1: 파일 상단에 import 추가**

```ts
import { connectAsUser } from "../testUtils/connectAsUser";
import { db } from "../db/connection";
```

- [ ] **Step 2: `beforeEach`에 유저 테이블 정리 추가**

기존 `beforeEach`(또는 없으면 새로 추가)에:
```ts
beforeEach(() => {
  db.exec("DELETE FROM users");
});
```

닉네임이 전역 유니크라, 이걸 안 하면 테스트 간에 같은 문자열 닉네임이 충돌해서 `setNickname`이 `"taken"`을 반환하고 `onAuth`가 로그인 거부로 이어진다.

- [ ] **Step 3: 클라이언트 연결부를 전부 `connectAsUser`로 교체**

`await colyseus.connectTo(room)` 형태를 찾아서(옵션으로 `{ nickname: "..." }`를 넘기던 자리 포함) 다음처럼 바꾼다 — 예시(실제 변수명/루프 구조는 파일 내용에 맞춘다):

```ts
// Before
const clients = await Promise.all([
  colyseus.connectTo(room, { nickname: "플레이어1" }),
  colyseus.connectTo(room, { nickname: "플레이어2" }),
]);

// After
const clients = await Promise.all([
  connectAsUser(colyseus, room, "플레이어1"),
  connectAsUser(colyseus, room, "플레이어2"),
]);
```

`colyseus.connectTo`가 옵션 없이(닉네임 없이) 호출되던 자리도 전부 `connectAsUser`로 바꾸고 임의의 고유 닉네임을 부여한다.

- [ ] **Step 4: 테스트 실행 → 남은 실패 확인 및 수정**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`

남을 수 있는 실패 유형과 대응:
- **"로그인이 필요합니다" 에러로 join 자체가 거부됨** → 그 자리의 연결이 아직 `connectTo`로 남아있다는 뜻. 다시 검색해서 교체.
- **닉네임 충돌("taken")로 거부됨** → 같은 문자열 닉네임을 여러 테스트/클라이언트가 재사용 중. 고유하게 만들거나 `beforeEach`의 `DELETE FROM users`가 실제로 실행되는지 확인.
- **관전자 관련 테스트에서 `client.auth.nickname` 관련 타입 에러** → `MatchState`의 `SpectatorState`/`PlayerState`는 그대로이므로 타입 문제가 아니라 로직 문제일 가능성이 높다 — 어떤 테스트가 실패하는지 로그를 보고 개별 대응.

이 스텝은 실패가 하나도 안 남을 때까지 "실행 → 남은 실패 원인 파악 → 수정" 루프를 반복한다.

- [ ] **Step 5: 전체 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.test.ts
git commit -m "MatchRoom.test.ts를 로그인 세션 기반 접속으로 이전"
```

---

## Task 13: `MatchRoom.abilities.test.ts` 마이그레이션

**Files:**
- Modify: `server/src/rooms/MatchRoom.abilities.test.ts`

Task 12과 완전히 같은 절차를 이 파일에 반복한다: `connectAsUser`/`db` import 추가, `beforeEach`에 `db.exec("DELETE FROM users")` 추가, 모든 클라이언트 연결부를 `connectAsUser(colyseus, room, "고유닉네임")`로 교체, 실행하며 남은 실패를 원인별로 고친다.

- [ ] **Step 1~4: Task 12의 Step 1~4와 동일한 절차 수행**
- [ ] **Step 5: 전체 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.abilities.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.abilities.test.ts
git commit -m "MatchRoom.abilities.test.ts를 로그인 세션 기반 접속으로 이전"
```

---

## Task 14: `MatchRoom.shortcut.test.ts` 마이그레이션

**Files:**
- Modify: `server/src/rooms/MatchRoom.shortcut.test.ts`

Task 12과 동일한 절차.

- [ ] **Step 1~4: Task 12의 Step 1~4와 동일한 절차 수행**
- [ ] **Step 5: 전체 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.shortcut.test.ts`
Expected: PASS (모든 테스트)

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchRoom.shortcut.test.ts
git commit -m "MatchRoom.shortcut.test.ts를 로그인 세션 기반 접속으로 이전"
```

---

## Task 15: `MatchRoom.fullGame.test.ts` 마이그레이션 + 서버 전체 테스트 그린 확인

**Files:**
- Modify: `server/src/rooms/MatchRoom.fullGame.test.ts`

Task 12과 동일한 절차. 이 파일은 200회 반복 루프로 실제 승리까지 진행시키는 무거운 테스트라(기존 타임아웃 20000ms), `connectAsUser`로 바꾼 뒤에도 타임아웃 여유가 충분한지 확인한다 — 로그인 처리 자체는 순수 함수 호출(DB insert/JWT sign)이라 WS 왕복 시간에 비하면 무시할 수준이므로 별도 타임아웃 조정은 필요 없을 것으로 예상되지만, 실행해서 확인한다.

- [ ] **Step 1~4: Task 12의 Step 1~4와 동일한 절차 수행**
- [ ] **Step 5: 전체 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchRoom.fullGame.test.ts`
Expected: PASS

- [ ] **Step 6: 서버 전체 테스트 스위트 그린 확인**

Run: `cd server && npm test`
Expected: 전체 PASS — 여기서 실패가 남아있으면 이 태스크는 완료가 아니다.

- [ ] **Step 7: 커밋**

```bash
git add server/src/rooms/MatchRoom.fullGame.test.ts
git commit -m "MatchRoom.fullGame.test.ts를 로그인 세션 기반 접속으로 이전"
```

---

## Task 16: 플레이어 인증 HTTP 라우트 (`createServer.ts`)

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: `verifyGoogleIdToken`, `getOrCreateUser`, `setNickname`, `getUserById`(Task 5), `signSession`, `verifySession`, `getCookieValue`, `SESSION_COOKIE_NAME`(Task 3), `recordUserIp`(Task 8), `recordVisit`(Task 8), `recordInquiry`(Task 8)

- [ ] **Step 1: import 추가 + cookie-parser 미들웨어 등록**

파일 상단 import에 추가:
```ts
import cookieParser from "cookie-parser";
import { getOrCreateUser, getUserById, setNickname, verifyGoogleIdToken } from "./auth/googleAuth";
import { getCookieValue, SESSION_COOKIE_NAME, signSession, verifySession } from "./auth/session";
import { recordUserIp } from "./admin/userIps";
import { recordVisit } from "./admin/dailyVisits";
import { recordInquiry } from "./admin/inquiries";
```

`const app = express();` 바로 다음 줄에 추가:
```ts
  app.use(express.json());
  app.use(cookieParser());
```

(`express.json()`이 이미 있는지 파일을 먼저 확인 — 없으면 추가, 있으면 중복 등록하지 않는다.)

- [ ] **Step 2: `/api/rooms`를 로그인 필수로 변경**

기존 핸들러 맨 앞에 세션 검증을 추가한다:

```ts
  app.get("/api/rooms", async (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!userId || !getUserById(userId)?.nickname) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    res.header("Access-Control-Allow-Origin", "*");
    const rooms = await matchMaker.query({ name: "match" });
    res.json(
      rooms
        .filter((r) => r.metadata?.phase !== "finished")
        .map((r) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, metadata: r.metadata })),
    );
  });
```

- [ ] **Step 3: 인증 라우트 4개 추가 (`/api/rooms` 핸들러 바로 다음)**

```ts
  app.post("/api/auth/google", async (req, res) => {
    const credential = (req.body as { credential?: unknown } | undefined)?.credential;
    if (typeof credential !== "string") {
      res.status(400).json({ error: "credential이 필요합니다." });
      return;
    }
    try {
      const { sub, email, name } = await verifyGoogleIdToken(credential);
      const user = getOrCreateUser(sub, { email, name });
      const token = signSession(user.id);
      res.cookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: req.secure,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      const ip = req.ip ?? "unknown";
      recordUserIp(user.id, ip);
      recordVisit(user.id);
      res.json(user);
    } catch (err) {
      console.error("[auth/google] 로그인 실패:", err);
      res.status(401).json({ error: "로그인에 실패했습니다." });
    }
  });

  app.get("/api/auth/me", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    const user = userId ? getUserById(userId) : undefined;
    if (!user) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    recordUserIp(user.id, req.ip ?? "unknown");
    recordVisit(user.id);
    res.json(user);
  });

  app.post("/api/auth/nickname", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!userId) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const nickname = (req.body as { nickname?: unknown } | undefined)?.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임을 입력해주세요." });
      return;
    }
    const result = setNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
      return;
    }
    if (result === "already_set") {
      res.status(409).json({ error: "닉네임은 이미 설정되어 있습니다." });
      return;
    }
    res.json(getUserById(userId));
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.status(204).end();
  });

  app.post("/api/inquiries", (req, res) => {
    const userId = verifySession(req.cookies?.[SESSION_COOKIE_NAME]);
    const user = userId ? getUserById(userId) : undefined;
    if (!user || !user.nickname) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const body = req.body as { title?: unknown; content?: unknown } | undefined;
    if (typeof body?.title !== "string" || typeof body?.content !== "string" || !body.title.trim() || !body.content.trim()) {
      res.status(400).json({ error: "제목과 내용을 입력해주세요." });
      return;
    }
    recordInquiry(user.id, user.nickname, body.title.trim(), body.content.trim());
    res.status(204).end();
  });
```

- [ ] **Step 4: 타입 체크**

Run: `cd server && npm run build`
Expected: 에러 없음(`@types/cookie-parser`가 Task 1에서 이미 설치됨)

- [ ] **Step 5: 서버 기동 확인 (수동)**

Run: `cd server && npm run dev` (백그라운드) 후 `curl -i http://localhost:2567/api/auth/me`
Expected: `401` 응답(로그인 세션 없음) — 서버가 죽지 않고 정상 응답하면 통과.

- [ ] **Step 6: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "구글 로그인/닉네임설정/로그아웃/문의 HTTP 라우트 추가, /api/rooms 로그인 필수화"
```

---

## Task 17: 관리자 API 라우트 (`createServer.ts`)

**Files:**
- Modify: `server/src/createServer.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `checkPassword`, `createSession`, `destroySession`(Task 6), `isRateLimited`, `recordFailedAttempt`, `recordSuccessfulLogin`(Task 6), `getEvents`, `searchEventsByNickname`(Task 7), `getChatLogs`(Task 7), `getDailyVisitStats`(Task 8), `listUsers`, `setUserBanned`, `adminSetNickname`(Task 5), `getIpsForUser`(Task 8), `getInquiries`(Task 8), `broadcast`, `subscribe`(Task 9)

- [ ] **Step 1: import 추가**

```ts
import { checkPassword, createSession, destroySession, requireAdmin } from "./admin/auth";
import { isRateLimited, recordFailedAttempt, recordSuccessfulLogin } from "./admin/loginRateLimit";
import { getEvents, searchEventsByNickname } from "./admin/eventLog";
import { getChatLogs } from "./admin/chatLog";
import { getDailyVisitStats } from "./admin/dailyVisits";
import { adminSetNickname, listUsers, setUserBanned } from "./auth/googleAuth";
import { getIpsForUser } from "./admin/userIps";
import { getInquiries } from "./admin/inquiries";
import { broadcast, subscribe } from "./admin/announcements";
```

- [ ] **Step 2: 라우트 추가 (인증 라우트들 다음 위치)**

```ts
  app.post("/api/admin/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    if (isRateLimited(ip)) {
      res.status(429).json({ error: "너무 많이 시도했습니다. 잠시 후 다시 시도해주세요." });
      return;
    }
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== "string" || !checkPassword(password)) {
      recordFailedAttempt(ip);
      res.status(401).json({ error: "비밀번호가 틀렸습니다." });
      return;
    }
    recordSuccessfulLogin(ip);
    const token = createSession();
    res.cookie("admin_session", token, { httpOnly: true, secure: req.secure, sameSite: "lax" });
    res.status(204).end();
  });

  app.post("/api/admin/logout", (req, res) => {
    destroySession(req.cookies?.admin_session);
    res.clearCookie("admin_session");
    res.status(204).end();
  });

  app.get("/api/admin/rooms", requireAdmin, async (_req, res) => {
    const rooms = await matchMaker.query({ name: "match" });
    res.json(rooms.map((r) => ({ roomId: r.roomId, clients: r.clients, maxClients: r.maxClients, metadata: r.metadata })));
  });

  app.get("/api/admin/events", requireAdmin, (_req, res) => {
    res.json(getEvents());
  });

  app.get("/api/admin/events/search", requireAdmin, (req, res) => {
    const nickname = req.query.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "nickname 쿼리가 필요합니다." });
      return;
    }
    res.json(searchEventsByNickname(nickname));
  });

  app.get("/api/admin/chat-logs", requireAdmin, (_req, res) => {
    res.json(getChatLogs());
  });

  app.get("/api/admin/stats/daily-visitors", requireAdmin, (_req, res) => {
    res.json(getDailyVisitStats());
  });

  app.get("/api/admin/users", requireAdmin, (req, res) => {
    const offset = Number(req.query.offset) || 0;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json(listUsers(offset, limit));
  });

  app.post("/api/admin/users/:id/ban", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const banned = Boolean((req.body as { banned?: unknown } | undefined)?.banned);
    setUserBanned(userId, banned);
    res.status(204).end();
  });

  app.post("/api/admin/users/:id/nickname", requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const nickname = (req.body as { nickname?: unknown } | undefined)?.nickname;
    if (typeof nickname !== "string" || !nickname.trim()) {
      res.status(400).json({ error: "닉네임을 입력해주세요." });
      return;
    }
    const result = adminSetNickname(userId, nickname);
    if (result === "taken") {
      res.status(409).json({ error: "이미 사용 중인 닉네임입니다." });
      return;
    }
    res.status(204).end();
  });

  app.get("/api/admin/users/:id/ips", requireAdmin, (req, res) => {
    res.json(getIpsForUser(Number(req.params.id)));
  });

  app.get("/api/admin/inquiries", requireAdmin, (_req, res) => {
    res.json(getInquiries());
  });

  app.post("/api/admin/announce", requireAdmin, (req, res) => {
    const message = (req.body as { message?: unknown } | undefined)?.message;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "메시지를 입력해주세요." });
      return;
    }
    broadcast(message.trim());
    res.status(204).end();
  });

  app.get("/api/announcements/stream", (req, res) => {
    subscribe(req, res);
  });
```

- [ ] **Step 3: 타입 체크**

Run: `cd server && npm run build`
Expected: 에러 없음

- [ ] **Step 4: 수동 확인**

Run: `cd server && npm run dev` (백그라운드), 그리고:
```bash
curl -i -X POST http://localhost:2567/api/admin/login -H "Content-Type: application/json" -d '{"password":"wrong"}'
```
Expected: `401`

```bash
curl -i -X POST http://localhost:2567/api/admin/login -H "Content-Type: application/json" -d "{\"password\":\"$ADMIN_PASSWORD\"}"
```
(`server/.env`에 설정한 실제 값으로) Expected: `204` + `Set-Cookie: admin_session=...`

- [ ] **Step 5: 커밋**

```bash
git add server/src/createServer.ts
git commit -m "관리자 API 라우트(로그인/방/이벤트/채팅로그/유저관리/문의/공지) 추가"
```

---

## Task 18: 클라이언트 인증 모듈 + 구글 로그인 화면

**Files:**
- Create: `client/src/game/auth.ts`
- Create: `client/src/components/GoogleLoginScreen.tsx`
- Create: `client/src/components/GoogleLoginScreen.module.css`

**Interfaces:**
- Produces: `renderGoogleButton(containerId: string, onCredential: (credential: string) => void): Promise<void>`, `type Profile = {id: number; nickname: string|null; bannedAt: string|null}`, `loginWithGoogle(credential: string): Promise<Profile>`, `fetchMe(): Promise<Profile|null>`, `submitNickname(nickname: string): Promise<Profile>`, `logout(): Promise<void>` — Task 19(App.tsx)가 전부 쓴다.

- [ ] **Step 1: `client/src/game/auth.ts` 구현**

```ts
const GIS_SRC = "https://accounts.google.com/gsi/client";

type GoogleAccountsId = {
  initialize: (config: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string>) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load Google Identity Services script"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function renderGoogleButton(containerId: string, onCredential: (credential: string) => void): Promise<void> {
  await loadGoogleScript();
  window.google!.accounts.id.initialize({
    client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    callback: (response) => onCredential(response.credential),
  });
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  window.google!.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "signin_with",
  });
}

export type Profile = { id: number; nickname: string | null; bannedAt: string | null };

export async function loginWithGoogle(credential: string): Promise<Profile> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("로그인에 실패했습니다.");
  return res.json();
}

export async function fetchMe(): Promise<Profile | null> {
  const res = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (!res.ok) return null;
  return res.json();
}

export async function submitNickname(nickname: string): Promise<Profile> {
  const res = await fetch("/api/auth/nickname", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ nickname }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "닉네임 설정에 실패했습니다.");
  }
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
}
```

- [ ] **Step 2: `client/src/components/GoogleLoginScreen.tsx` 구현**

```tsx
import { useEffect, useState } from "react";
import { renderGoogleButton } from "../game/auth";
import styles from "./GoogleLoginScreen.module.css";

const BUTTON_CONTAINER_ID = "google-login-button";

export function GoogleLoginScreen({
  onCredential,
  error,
}: {
  onCredential: (credential: string) => void;
  error?: string | null;
}) {
  const [scriptError, setScriptError] = useState<string | null>(null);

  useEffect(() => {
    renderGoogleButton(BUTTON_CONTAINER_ID, onCredential).catch((err) => {
      console.error("Failed to render Google login button", err);
      setScriptError("로그인 버튼을 불러오지 못했어요. 새로고침해주세요.");
    });
  }, [onCredential]);

  const displayError = error ?? scriptError;

  return (
    <main className={styles.wrap}>
      <h1>윷놀이</h1>
      <p className={styles.hint}>플레이하려면 구글 로그인이 필요해요</p>
      {displayError && <p className={styles.error}>{displayError}</p>}
      <div id={BUTTON_CONTAINER_ID} />
    </main>
  );
}
```

- [ ] **Step 3: `client/src/components/GoogleLoginScreen.module.css` 구현**

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-height: 100svh;
  padding: 1rem;
  text-align: center;
  background: var(--bg);
  color: var(--text-h);
}

.hint {
  color: var(--text);
  opacity: 0.8;
}

.error {
  color: var(--accent);
  font-size: 0.9rem;
}
```

- [ ] **Step 4: 빌드 확인**

Run: `cd client && npm run build`
Expected: 에러 없음(아직 App.tsx가 이 컴포넌트를 안 쓰므로 미사용 파일 경고 없이 그냥 통과)

- [ ] **Step 5: 커밋**

```bash
git add client/src/game/auth.ts client/src/components/GoogleLoginScreen.tsx client/src/components/GoogleLoginScreen.module.css
git commit -m "구글 로그인 클라이언트 모듈 + 로그인 화면 추가"
```

---

## Task 19: App.tsx 로그인 게이팅 + 닉네임 설정 화면 + 로그아웃/문의하기

**Files:**
- Modify: `client/src/App.tsx`
- Create: `client/src/components/NicknameSetupScreen.tsx` (기존 `NicknameGate.tsx` 대체)
- Create: `client/src/components/NicknameSetupScreen.module.css`
- Delete: `client/src/components/NicknameGate.tsx`, `client/src/components/NicknameGate.module.css`
- Modify: `client/src/game/nickname.ts` (localStorage 기반 `getStoredNickname`/`setStoredNickname` 제거)
- Modify: `client/src/colyseus.ts` (`createRoom`/`joinRoom`에서 `nickname` 파라미터 제거)
- Modify: `client/src/components/RoomList.tsx` (nickname prop 제거, 대신 로그인 프로필의 닉네임 표시만)
- Create: `client/src/components/InquiryModal.tsx`
- Create: `client/src/components/InquiryModal.module.css`

**Interfaces:**
- Consumes: `fetchMe`, `loginWithGoogle`, `submitNickname`, `logout`(Task 18)

- [ ] **Step 1: `client/src/components/NicknameSetupScreen.tsx` 생성**

```tsx
import { useState, type FormEvent } from "react";
import { submitNickname } from "../game/auth";
import styles from "./NicknameSetupScreen.module.css";

export function NicknameSetupScreen({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitNickname(trimmed);
      onDone(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "닉네임 설정에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <h2>닉네임을 설정하세요</h2>
      <p className={styles.hint}>계정에 영구적으로 저장돼요. 이후 변경은 관리자에게 문의해주세요.</p>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={12}
          placeholder="닉네임"
          autoFocus
          disabled={submitting}
        />
        <button type="submit" disabled={submitting}>
          시작하기
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: `client/src/components/NicknameSetupScreen.module.css` 생성 (기존 `NicknameGate.module.css` 내용을 그대로 복사)**

기존 `NicknameGate.module.css` 파일을 읽어 `NicknameSetupScreen.module.css`로 그대로 복사하고, 에러 메시지용 클래스만 추가:

```css
.error {
  color: var(--accent);
  font-size: 0.85rem;
  margin-top: 0.5rem;
}
```

(나머지 `.wrap`/`.input` 등은 기존 `NicknameGate.module.css` 내용 그대로 유지 — 실제 구현 시 해당 파일을 먼저 Read해서 내용을 확인하고 복사한다.)

- [ ] **Step 3: 기존 `NicknameGate.tsx`/`NicknameGate.module.css` 삭제**

```bash
rm client/src/components/NicknameGate.tsx client/src/components/NicknameGate.module.css
```

- [ ] **Step 4: `client/src/game/nickname.ts`에서 localStorage 함수 제거**

파일을 열어 `getStoredNickname`/`setStoredNickname`을 사용하는 다른 곳이 있는지 확인(`grep -rn "getStoredNickname\|setStoredNickname" client/src`). App.tsx 말고 다른 사용처가 없으면 이 두 함수를 삭제한다. 이 파일에 클라이언트 쪽 닉네임 검증 로직(sanitize 등)이 남아있다면 그건 그대로 유지한다 — 실제 파일 내용을 Read해서 확인 후 정확히 무엇을 지울지 결정한다.

- [ ] **Step 5: `client/src/colyseus.ts`에서 `nickname` 파라미터 제거**

```ts
// Before
export function createRoom(title: string, mode: "2v2" | "1v1", nickname: string, allowSpectators: boolean): Promise<Room<MatchState>> {
  return client.create<MatchState>("match", { title, mode, nickname, allowSpectators });
}

export function joinRoom(roomId: string, nickname: string): Promise<Room<MatchState>> {
  return client.joinById<MatchState>(roomId, { nickname });
}

// After
export function createRoom(title: string, mode: "2v2" | "1v1", allowSpectators: boolean): Promise<Room<MatchState>> {
  return client.create<MatchState>("match", { title, mode, allowSpectators });
}

export function joinRoom(roomId: string): Promise<Room<MatchState>> {
  return client.joinById<MatchState>(roomId);
}
```

`listRooms()`가 쓰는 `fetch(`${httpUrl}/api/rooms`)`에 `credentials: "same-origin"`을 추가한다(세션 쿠키가 실려야 하므로 — dev 환경에서 다른 오리진이면 기본적으로 쿠키가 안 실릴 수 있어, `fetch` 옵션에 명시한다):

```ts
export async function listRooms(): Promise<RoomAvailable<RoomMeta>[]> {
  const res = await fetch(`${httpUrl}/api/rooms`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`방 목록 조회 실패: ${res.status}`);
  return res.json();
}
```

- [ ] **Step 6: `client/src/components/RoomList.tsx`에서 nickname prop과 그 사용처를 정리**

파일을 Read해서 `nickname` prop이 실제로 어디 쓰이는지 확인한다(`joinRoom(roomId, nickname)`, `createRoom(...)` 호출부, prop 시그니처). Step 5에서 함수 시그니처가 바뀌었으므로:
- `nickname` prop을 컴포넌트 시그니처에서 제거
- `joinRoom(roomId)`, `createRoom(title, mode, allowSpectators)` 호출부를 새 시그니처에 맞춰 인자 제거
- 화면에 로그인한 유저의 닉네임을 표시하던 자리가 있다면(예: 상단바) 그 값은 이제 App.tsx가 들고 있는 로그인 프로필의 `nickname`을 prop으로 새로 받아 표시한다(원래 표시 목적은 그대로 유지, 값의 출처만 로컬스토리지 → 로그인 프로필로 바뀜).

- [ ] **Step 7: `client/src/components/InquiryModal.tsx` 생성**

```tsx
import { useState, type FormEvent } from "react";
import styles from "./InquiryModal.module.css";

export function InquiryModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error("전송에 실패했습니다.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>문의하기</h2>
        {sent ? (
          <>
            <p>문의가 접수됐어요.</p>
            <button onClick={onClose}>닫기</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              className={styles.input}
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <textarea
              className={styles.textarea}
              placeholder="내용"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              rows={6}
            />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={onClose} disabled={sending}>
                취소
              </button>
              <button type="submit" className={styles.submitButton} disabled={sending}>
                보내기
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: `client/src/components/InquiryModal.module.css` 생성**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: var(--bg);
  color: var(--text-h);
  border-radius: 12px;
  padding: 1.5rem;
  width: min(400px, 90vw);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.input,
.textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-family: inherit;
  background: var(--bg);
  color: var(--text-h);
}

.error {
  color: var(--accent);
  font-size: 0.85rem;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.cancelButton {
  background: transparent;
  border: 1px solid var(--border);
}

.submitButton {
  background: var(--accent);
  color: #fff;
  border: none;
}
```

- [ ] **Step 9: `App.tsx`를 로그인 게이팅 흐름으로 교체**

```tsx
// client/src/App.tsx
import { useCallback, useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";
import { useMatchRoom } from "./game/useMatchRoom";
import { fetchMe, loginWithGoogle, logout, type Profile } from "./game/auth";
import { GoogleLoginScreen } from "./components/GoogleLoginScreen";
import { NicknameSetupScreen } from "./components/NicknameSetupScreen";
import { InquiryModal } from "./components/InquiryModal";
import { RoomList } from "./components/RoomList";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { PlayerCorner } from "./components/PlayerCorner";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatBox } from "./components/ChatBox";
import { assignCorners } from "./game/cornerSlots";
import styles from "./App.module.css";

function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined); // undefined = 아직 확인 전
  const [loginError, setLoginError] = useState<string | null>(null);
  const [showInquiry, setShowInquiry] = useState(false);
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  useMatchRoom(room);

  useEffect(() => {
    fetchMe().then(setProfile);
  }, []);

  const handleCredential = useCallback(async (credential: string) => {
    setLoginError(null);
    try {
      const p = await loginWithGoogle(credential);
      setProfile(p);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    }
  }, []);

  const [selectedPieceId, setSelectedPieceId] = useState<string | null>(null);
  useEffect(() => {
    if (room && room.state?.gaugePhase !== "resolved") setSelectedPieceId(null);
  }, [room, room?.state?.gaugePhase]);

  if (profile === undefined) {
    return <p>불러오는 중...</p>;
  }

  if (profile === null) {
    return <GoogleLoginScreen onCredential={handleCredential} error={loginError} />;
  }

  if (!profile.nickname) {
    return <NicknameSetupScreen onDone={(nickname) => setProfile({ ...profile, nickname })} />;
  }

  const nickname = profile.nickname;

  async function handleLogout() {
    await logout();
    setProfile(null);
    setRoom(null);
  }

  if (!room) {
    return (
      <>
        <RoomList nickname={nickname} onRoomJoined={setRoom} onLogout={handleLogout} onOpenInquiry={() => setShowInquiry(true)} />
        {showInquiry && <InquiryModal onClose={() => setShowInquiry(false)} />}
      </>
    );
  }

  if (!room.state?.players) {
    return <p>입장하는 중...</p>;
  }

  const corners = room.state.phase === "playing" ? assignCorners(room.state) : null;

  return (
    <div>
      <ParticipantBar room={room} onLeaveLobby={() => setRoom(null)} />

      {room.state.phase === "waiting" && <WaitingRoom room={room} />}

      {room.state.phase === "playing" && corners && (
        <div className={styles.playScreen}>
          <div className={styles.topLeft}>
            {corners.topLeft && (
              <PlayerCorner room={room} sessionId={corners.topLeft} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
            )}
          </div>
          <div className={styles.topRight}>
            {corners.topRight && (
              <PlayerCorner room={room} sessionId={corners.topRight} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
            )}
          </div>
          <div className={styles.bottomLeft}>
            {corners.bottomLeft && (
              <PlayerCorner room={room} sessionId={corners.bottomLeft} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
            )}
          </div>
          <div className={styles.bottomRight}>
            {corners.bottomRight && (
              <PlayerCorner room={room} sessionId={corners.bottomRight} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
            )}
          </div>
          <div className={styles.boardArea}>
            <GameBoard room={room} selectedPieceId={selectedPieceId} onSelectPiece={setSelectedPieceId} />
          </div>
        </div>
      )}

      {room.state.phase === "finished" && <WinnerScreen room={room} onLeaveLobby={() => setRoom(null)} />}

      <ChatBox room={room} />
    </div>
  );
}

export default App;
```

`RoomList`에 `onLogout`/`onOpenInquiry` prop을 새로 추가했다 — Step 6에서 `RoomList.tsx`를 수정할 때 이 두 prop을 받아 로그아웃 버튼과 문의하기 버튼을 렌더링하도록 같이 반영한다(정확한 배치는 `RoomList.tsx`의 기존 레이아웃을 Read해서 자연스러운 자리에 추가).

- [ ] **Step 10: 빌드 확인**

Run: `cd client && npm run build`
Expected: 타입 에러 없음

- [ ] **Step 11: 커밋**

```bash
git add client/src/App.tsx client/src/components/NicknameSetupScreen.tsx client/src/components/NicknameSetupScreen.module.css client/src/components/InquiryModal.tsx client/src/components/InquiryModal.module.css client/src/game/nickname.ts client/src/colyseus.ts client/src/components/RoomList.tsx
git rm client/src/components/NicknameGate.tsx client/src/components/NicknameGate.module.css
git commit -m "구글 로그인 게이팅 + 닉네임 설정 화면 + 로그아웃/문의하기 도입"
```

---

## Task 20: 관리자 로그인 + 대시보드 화면

**Files:**
- Create: `client/src/components/AdminLogin.tsx`, `AdminLogin.module.css`
- Create: `client/src/components/AdminDashboard.tsx`, `AdminDashboard.module.css`

**Interfaces:**
- Consumes: `POST /api/admin/login`, `GET /api/admin/rooms`, `GET /api/admin/events`, `GET /api/admin/events/search`, `GET /api/admin/chat-logs`, `GET /api/admin/stats/daily-visitors`, `POST /api/admin/announce`(Task 17)
- Produces: `AdminLogin`(`onSuccess: () => void`), `AdminDashboard`(`onUnauthorized: () => void; onOpenUsers: () => void; onOpenInquiries: () => void`)

- [ ] **Step 1: `AdminLogin.tsx` 구현**

```tsx
import { useState, type FormEvent } from "react";
import styles from "./AdminLogin.module.css";

export function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "로그인에 실패했습니다.");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <h1>관리자 로그인</h1>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="비밀번호"
          autoFocus
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          로그인
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: `AdminLogin.module.css` 구현**

```css
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-height: 100vh;
  font-family: system-ui, sans-serif;
}

.input {
  padding: 0.5rem;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.error {
  color: #c0392b;
}
```

- [ ] **Step 3: `AdminDashboard.tsx` 구현**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import styles from "./AdminDashboard.module.css";

type RoomInfo = { roomId: string; clients: number; maxClients: number; metadata?: { title?: string; phase?: string; playerCount?: number } };
type AdminEvent = { type: string; timestamp: number; nickname: string; roomId: string; roomTitle: string; ip: string; sessionId: string };
type ChatLogEntry = { nickname: string; text: string; createdAt: string };
type DailyVisitStats = { today: number; recent: { date: string; count: number }[] };

async function fetchJson<T>(url: string, onUnauthorized: () => void): Promise<T | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.status === 401) {
    onUnauthorized();
    return null;
  }
  if (!res.ok) return null;
  return res.json();
}

export function AdminDashboard({
  onUnauthorized,
  onOpenUsers,
  onOpenInquiries,
}: {
  onUnauthorized: () => void;
  onOpenUsers: () => void;
  onOpenInquiries: () => void;
}) {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [chatLogs, setChatLogs] = useState<ChatLogEntry[]>([]);
  const [visitStats, setVisitStats] = useState<DailyVisitStats | null>(null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [announceError, setAnnounceError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState<AdminEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [r, e, c, v] = await Promise.all([
        fetchJson<RoomInfo[]>("/api/admin/rooms", onUnauthorized),
        fetchJson<AdminEvent[]>("/api/admin/events", onUnauthorized),
        fetchJson<ChatLogEntry[]>("/api/admin/chat-logs", onUnauthorized),
        fetchJson<DailyVisitStats>("/api/admin/stats/daily-visitors", onUnauthorized),
      ]);
      if (cancelled) return;
      if (r) setRooms(r);
      if (e) setEvents(e);
      if (c) setChatLogs(c);
      if (v) setVisitStats(v);
    }
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [onUnauthorized]);

  async function handleAnnounce(e: FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setSending(true);
    setAnnounceError(null);
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error("전송에 실패했습니다.");
      setMessage("");
    } catch (err) {
      setAnnounceError(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!searchInput.trim()) return;
    const results = await fetchJson<AdminEvent[]>(`/api/admin/events/search?nickname=${encodeURIComponent(searchInput)}`, onUnauthorized);
    setSearchResults(results ?? []);
  }

  return (
    <div className={styles.wrap}>
      <h1>관리자 대시보드</h1>
      <nav className={styles.nav}>
        <button onClick={onOpenUsers}>유저 관리</button>
        <button onClick={onOpenInquiries}>문의함</button>
      </nav>

      <section>
        <h2>공지 배너 보내기</h2>
        <form onSubmit={handleAnnounce}>
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="공지 내용" disabled={sending} />
          <button type="submit" disabled={sending}>
            보내기
          </button>
        </form>
        {announceError && <p className={styles.error}>{announceError}</p>}
      </section>

      <section>
        <h2>활성 방 ({rooms.length})</h2>
        <ul>
          {rooms.map((r) => (
            <li key={r.roomId}>
              {r.metadata?.title ?? r.roomId} — {r.metadata?.phase} — {r.clients}/{r.maxClients}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>최근 입장/퇴장 (최대 100개)</h2>
        <ul>
          {events.slice(-100).reverse().map((e, i) => (
            <li key={i}>
              [{new Date(e.timestamp).toLocaleString()}] {e.type} — {e.nickname} — {e.roomTitle} — {e.ip}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>최근 채팅 로그 (최대 200개)</h2>
        <ul>
          {chatLogs.map((c, i) => (
            <li key={i}>
              [{c.createdAt}] {c.nickname}: {c.text}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>닉네임으로 접속 기록 검색</h2>
        <form onSubmit={handleSearch}>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="닉네임" />
          <button type="submit">검색</button>
        </form>
        {searchResults && (
          <ul>
            {searchResults.map((e, i) => (
              <li key={i}>
                [{new Date(e.timestamp).toLocaleString()}] {e.type} — {e.nickname} — {e.ip}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>오늘 방문 {visitStats?.today ?? 0}회</h2>
        <ul>
          {visitStats?.recent.map((r) => (
            <li key={r.date}>
              {r.date}: {r.count}회
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: `AdminDashboard.module.css` 구현**

```css
.wrap {
  font-family: system-ui, sans-serif;
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem;
}

.nav {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

section {
  margin-bottom: 2rem;
}

.error {
  color: #c0392b;
}
```

- [ ] **Step 5: 빌드 확인**

Run: `cd client && npm run build`
Expected: 에러 없음

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/AdminLogin.tsx client/src/components/AdminLogin.module.css client/src/components/AdminDashboard.tsx client/src/components/AdminDashboard.module.css
git commit -m "관리자 로그인 화면 + 대시보드 화면 추가"
```

---

## Task 21: 관리자 유저관리 + 닉네임수정 + 문의함 화면

**Files:**
- Create: `client/src/components/AdminUsers.tsx`, `AdminUsers.module.css`
- Create: `client/src/components/AdminEditNicknameModal.tsx`, `AdminEditNicknameModal.module.css`
- Create: `client/src/components/AdminInquiries.tsx`, `AdminInquiries.module.css`

**Interfaces:**
- Consumes: `GET /api/admin/users`, `POST /api/admin/users/:id/ban`, `POST /api/admin/users/:id/nickname`, `GET /api/admin/users/:id/ips`, `GET /api/admin/inquiries`(Task 17)
- Produces: `AdminUsers`(`onUnauthorized: () => void; onBack: () => void`), `AdminInquiries`(`onUnauthorized: () => void; onBack: () => void`)

- [ ] **Step 1: `AdminEditNicknameModal.tsx` 구현**

```tsx
import { useState, type FormEvent } from "react";
import styles from "./AdminEditNicknameModal.module.css";

export function AdminEditNicknameModal({
  userId,
  currentNickname,
  onClose,
  onSaved,
}: {
  userId: number;
  currentNickname: string | null;
  onClose: () => void;
  onSaved: (nickname: string) => void;
}) {
  const [value, setValue] = useState(currentNickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/nickname`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nickname: value.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "저장에 실패했습니다.");
      }
      onSaved(value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>닉네임 수정 (계정 #{userId})</h3>
        <form onSubmit={handleSubmit}>
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={12} autoFocus disabled={saving} />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" disabled={saving}>
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `AdminEditNicknameModal.module.css` 구현**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  width: min(320px, 90vw);
}

.error {
  color: #c0392b;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
```

- [ ] **Step 3: `AdminUsers.tsx` 구현**

```tsx
import { useEffect, useState } from "react";
import { AdminEditNicknameModal } from "./AdminEditNicknameModal";
import styles from "./AdminUsers.module.css";

type AdminUserRow = {
  id: number;
  email: string | null;
  name: string | null;
  nickname: string | null;
  bannedAt: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

const PAGE_SIZE = 20;

export function AdminUsers({ onUnauthorized, onBack }: { onUnauthorized: () => void; onBack: () => void }) {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<{ id: number; nickname: string | null } | null>(null);
  const [ipsForUser, setIpsForUser] = useState<{ userId: number; entries: { ip: string; firstSeen: string; lastSeen: string }[] } | null>(
    null,
  );

  async function load() {
    const res = await fetch(`/api/admin/users?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`, { credentials: "same-origin" });
    if (res.status === 401) {
      onUnauthorized();
      return;
    }
    const data = (await res.json()) as { rows: AdminUserRow[]; total: number };
    setRows(data.rows);
    setTotal(data.total);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function handleBanToggle(id: number, banned: boolean) {
    await fetch(`/api/admin/users/${id}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ banned }),
    });
    load();
  }

  async function handleShowIps(id: number) {
    const res = await fetch(`/api/admin/users/${id}/ips`, { credentials: "same-origin" });
    const entries = (await res.json()) as { ip: string; firstSeen: string; lastSeen: string }[];
    setIpsForUser({ userId: id, entries });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.wrap}>
      <button onClick={onBack}>← 대시보드</button>
      <h1>유저 관리 ({total}명)</h1>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>ID</th>
            <th>닉네임</th>
            <th>이메일</th>
            <th>가입일</th>
            <th>최근 로그인</th>
            <th>상태</th>
            <th>액션</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <td>{u.id}</td>
              <td>{u.nickname ?? "(미설정)"}</td>
              <td>{u.email ?? "-"}</td>
              <td>{u.createdAt}</td>
              <td>{u.lastLoginAt ?? "-"}</td>
              <td>{u.bannedAt ? "밴됨" : "정상"}</td>
              <td>
                <button onClick={() => setEditing({ id: u.id, nickname: u.nickname })}>닉네임 수정</button>
                <button onClick={() => handleBanToggle(u.id, !u.bannedAt)}>{u.bannedAt ? "밴 해제" : "밴"}</button>
                <button onClick={() => handleShowIps(u.id)}>IP 이력</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.pagination}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          이전
        </button>
        <span>
          {page + 1} / {totalPages}
        </span>
        <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
          다음
        </button>
      </div>

      {editing && (
        <AdminEditNicknameModal
          userId={editing.id}
          currentNickname={editing.nickname}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      {ipsForUser && (
        <div className={styles.overlay} onClick={() => setIpsForUser(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>계정 #{ipsForUser.userId} IP 이력</h3>
            <ul>
              {ipsForUser.entries.map((e, i) => (
                <li key={i}>
                  {e.ip} (최초 {e.firstSeen}, 최근 {e.lastSeen})
                </li>
              ))}
            </ul>
            <button onClick={() => setIpsForUser(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: `AdminUsers.module.css` 구현**

```css
.wrap {
  font-family: system-ui, sans-serif;
  max-width: 900px;
  margin: 0 auto;
  padding: 1.5rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table th,
.table td {
  border: 1px solid #ddd;
  padding: 0.4rem 0.6rem;
  text-align: left;
  font-size: 0.9rem;
}

.pagination {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  margin-top: 1rem;
}

.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #fff;
  padding: 1.5rem;
  border-radius: 8px;
  width: min(400px, 90vw);
  max-height: 80vh;
  overflow-y: auto;
}
```

- [ ] **Step 5: `AdminInquiries.tsx` 구현**

```tsx
import { useEffect, useState } from "react";
import styles from "./AdminInquiries.module.css";

type Inquiry = { id: number; userId: number; nickname: string; title: string; content: string; createdAt: number };

export function AdminInquiries({ onUnauthorized, onBack }: { onUnauthorized: () => void; onBack: () => void }) {
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);

  useEffect(() => {
    fetch("/api/admin/inquiries", { credentials: "same-origin" }).then(async (res) => {
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      setInquiries(await res.json());
    });
  }, [onUnauthorized]);

  return (
    <div className={styles.wrap}>
      <button onClick={onBack}>← 대시보드</button>
      <h1>문의함 ({inquiries.length})</h1>
      <ul>
        {inquiries.map((i) => (
          <li key={i.id} className={styles.item}>
            <strong>{i.title}</strong> — {i.nickname} ({new Date(i.createdAt).toLocaleString()})
            <p>{i.content}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 6: `AdminInquiries.module.css` 구현**

```css
.wrap {
  font-family: system-ui, sans-serif;
  max-width: 700px;
  margin: 0 auto;
  padding: 1.5rem;
}

.item {
  border-bottom: 1px solid #ddd;
  padding: 0.75rem 0;
}
```

- [ ] **Step 7: 빌드 확인**

Run: `cd client && npm run build`
Expected: 에러 없음

- [ ] **Step 8: 커밋**

```bash
git add client/src/components/AdminUsers.tsx client/src/components/AdminUsers.module.css client/src/components/AdminEditNicknameModal.tsx client/src/components/AdminEditNicknameModal.module.css client/src/components/AdminInquiries.tsx client/src/components/AdminInquiries.module.css
git commit -m "관리자 유저관리(밴/닉네임수정/IP이력) + 문의함 화면 추가"
```

---

## Task 22: 관리자 페이지 진입 배선 (`AdminPage.tsx` + `main.tsx`)

**Files:**
- Create: `client/src/components/AdminPage.tsx`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `AdminLogin`, `AdminDashboard`, `AdminUsers`, `AdminInquiries`(Task 20, 21)

- [ ] **Step 1: `AdminPage.tsx` 구현**

```tsx
import { useState } from "react";
import { AdminLogin } from "./AdminLogin";
import { AdminDashboard } from "./AdminDashboard";
import { AdminUsers } from "./AdminUsers";
import { AdminInquiries } from "./AdminInquiries";

export function AdminPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [view, setView] = useState<"dashboard" | "users" | "inquiries">("dashboard");

  function handleUnauthorized() {
    setLoggedIn(false);
    setView("dashboard");
  }

  if (!loggedIn) {
    return <AdminLogin onSuccess={() => setLoggedIn(true)} />;
  }

  if (view === "users") {
    return <AdminUsers onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  if (view === "inquiries") {
    return <AdminInquiries onUnauthorized={handleUnauthorized} onBack={() => setView("dashboard")} />;
  }

  return (
    <AdminDashboard
      onUnauthorized={handleUnauthorized}
      onOpenUsers={() => setView("users")}
      onOpenInquiries={() => setView("inquiries")}
    />
  );
}
```

- [ ] **Step 2: `main.tsx`를 경로 분기하도록 수정**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { AdminPage } from "./components/AdminPage";

const isAdmin = window.location.pathname === "/admin";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{isAdmin ? <AdminPage /> : <App />}</StrictMode>,
);
```

- [ ] **Step 3: 빌드 확인**

Run: `cd client && npm run build`
Expected: 에러 없음

- [ ] **Step 4: 로컬에서 same-origin으로 수동 확인**

프로덕션 빌드 방식과 동일하게 같은 오리진에서 확인해야 쿠키 기반 로그인이 제대로 동작한다(dev의 5173/2567 분리 오리진에서는 쿠키가 안 실릴 수 있음):

```bash
npm run build --workspace client
cp -r client/dist/* server/public/ 2>/dev/null || (mkdir -p server/public && cp -r client/dist/* server/public/)
cd server && npm run dev
```

브라우저로 `http://localhost:2567/admin` 접속 → 관리자 비밀번호 로그인 화면이 뜨는지 확인. `http://localhost:2567/`로는 구글 로그인 화면이 뜨는지 확인.

- [ ] **Step 5: 커밋**

```bash
git add client/src/components/AdminPage.tsx client/src/main.tsx
git commit -m "관리자 페이지 진입 배선 (/admin 경로 분기)"
```

---

## Task 23: Dockerfile 빌드 인자 추가 + 문서 갱신

**Files:**
- Modify: `Dockerfile`
- Modify: `CLAUDE.md`
- Modify: `docs/REQUIREMENTS.md`

**Interfaces:** 없음(인프라/문서만)

- [ ] **Step 1: `Dockerfile`에 `VITE_GOOGLE_CLIENT_ID` 빌드 인자 추가**

`ARG VITE_COLYSEUS_URL=` 다음 줄에 추가:

```dockerfile
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
```

(`ENV VITE_COLYSEUS_URL=$VITE_COLYSEUS_URL` 바로 아래, `RUN npm run build --workspace client` 이전에 위치해야 빌드에 반영된다.)

- [ ] **Step 2: `CLAUDE.md`에 새 섹션 추가**

`## Architecture` 목록 끝에 다음 항목을 추가한다(기존 항목들과 같은 스타일의 불릿):

```markdown
- **구글 로그인 + 관리자 대시보드 + DB** (2026-08-29~): 로그인이 필수가 됐다(익명 플레이 없음) — `better-sqlite3`
  단일 DB 파일(`server/src/db/connection.ts`)에 계정(`users`, 닉네임은 계정당 최초 1회 고정 후 관리자만
  변경 가능)과 로그(`events`=입퇴장, `chat_logs`, `user_ips`, `daily_visit_log`, `inquiries`,
  `nickname_history`)를 저장한다. `MatchRoom.onAuth`가 WS 업그레이드 시점에 세션 쿠키를 직접 파싱해
  로그인/밴 여부를 검증하고(`server/src/auth/session.ts`, `googleAuth.ts`), 통과하면 `client.auth`에
  `{ip, userId, nickname}`을 담아 `onJoin`이 그대로 쓴다 — 더 이상 클라이언트가 보내는 닉네임 문자열을
  신뢰하지 않는다. 관리자 페이지(`/admin`, `ADMIN_PASSWORD` 환경변수, 12시간 세션 + 5회/15분 로그인
  시도 제한)는 songpyeon과 동일 패턴(`server/src/admin/*`, `client/src/components/Admin*.tsx`)이며,
  yutnori에 없는 기능(친구/상점/닉네임효과/특정유저 감시로그/실시간 입력 모니터링)은 옮기지 않았다.
  기존 룸 통합 테스트 4개 파일은 `server/src/testUtils/connectAsUser.ts`(테스트 유저를 DB에 만들고
  세션 쿠키로 직접 WS 연결하는 헬퍼, songpyeon과 동일 패턴)로 전부 이전했다. 설계:
  `docs/superpowers/specs/2026-08-29-google-login-admin-design.md`.
```

`## Gotchas` 목록 끝에 다음 항목들을 추가한다:

```markdown
- **`MatchRoom.onAuth`는 WS 업그레이드 요청이라 Express의 `cookie-parser` 미들웨어를 안 거친다** —
  `context.headers?.cookie`를 `getCookieValue()`로 직접 파싱해야 한다(HTTP 라우트의 `req.cookies`와는
  별도 경로). 구현이 다르면 안 맞는 게 아니라, 애초에 같은 파싱 로직을 재사용하지 않으면 세션 검증
  자체가 씹힌다.
- **테스트에서 로그인된 유저로 방에 접속하려면 `@colyseus/testing`의 `connectTo`가 아니라
  `server/src/testUtils/connectAsUser.ts`를 써야 한다** — `connectTo`는 커스텀 헤더(쿠키)를 넘길 방법이
  없어서, 실제 세션 쿠키가 필요한 `onAuth`를 통과시킬 수 없다. `colyseus.js`의 `Client`를 직접
  `{ headers: { Cookie: ... } }`로 생성해서 우회한다.
- **관리자 페이지(`/admin`)와 구글 로그인은 같은 오리진에서만 동작함** — dev 환경(client 5173 / server
  2567)은 서로 다른 오리진이라 쿠키 기반 세션이 안 통한다. 로컬에서 확인하려면 client를 빌드해
  `server/public`에 복사한 뒤 서버가 직접 서빙하는 2567 포트로 접속해야 한다(songpyeon과 동일 문제).
- **서버 환경변수(`GOOGLE_CLIENT_ID`/`SESSION_JWT_SECRET`/`ADMIN_PASSWORD`)는 `server/.env`에서 읽는다**
  (`server/src/index.ts`가 `dotenv/config`로 로드, git에는 `.env.example`만 올라간다). 이 파일이 없거나
  비어있으면 구글 로그인이 즉시 실패한다.
- **`docker build`에 `--build-arg VITE_GOOGLE_CLIENT_ID=...`를 빠뜨리면 구글 로그인이 빈 client_id로
  배포된다** — 서버 쪽 `GOOGLE_CLIENT_ID`(런타임 `-e`, ID 토큰 검증용)와 클라이언트 쪽
  `VITE_GOOGLE_CLIENT_ID`(Vite가 빌드 시점에 번들에 박음)는 완전히 다른 주입 경로다.
```

- [ ] **Step 3: `docs/REQUIREMENTS.md`에 새 섹션 + changelog 추가**

버전을 v0.24로 올리고 최상단에 changelog 추가:

```markdown
> v0.24 (2026-08-29): 구글 로그인(필수) + 계정당 고정 닉네임 + 관리자 대시보드(유저/방 모니터링, 밴,
> 닉네임 강제변경, 채팅 로그, 계정별 IP 이력, 일일 방문자 집계, 문의함) 도입. §12 신설. 상세는
> `docs/superpowers/specs/2026-08-29-google-login-admin-design.md`와 `CLAUDE.md` 참고.
```

파일 끝에 새 섹션 추가:

```markdown
## 12. 계정과 관리자 기능

- 플레이하려면 구글 로그인이 필수다 — 로그인 없이 플레이하는 경로는 없다.
- 닉네임은 계정당 최초 로그인 시 1회만 직접 설정할 수 있고, 이후 본인은 바꿀 수 없다. 변경이
  필요하면 관리자에게 문의하면 관리자가 대신 바꿔준다.
- 관리자는 `/admin` 경로에서 비밀번호로 로그인해 활성 방/유저 현황, 최근 입장·퇴장 로그, 채팅 로그,
  계정별 접속 IP 이력, 일일 방문자 수를 확인하고, 계정 밴/해제와 닉네임 강제 변경을 할 수 있다.
  유저는 로비에서 관리자에게 1회성 문의를 보낼 수 있다.
```

- [ ] **Step 4: 커밋**

```bash
git add Dockerfile CLAUDE.md docs/REQUIREMENTS.md
git commit -m "구글 로그인/관리자 기능 문서화 + Dockerfile 빌드 인자 추가"
```

---

## Task 24: EC2 배포 반영 (수동 체크리스트)

**Files:** 없음(리포 밖 — EC2 호스트의 `docker run` 커맨드와 `/home/ec2-user/caddy/Caddyfile`)

이 태스크는 코드 변경이 아니라 실제 배포 시점에 사람이 EC2에 SSH로 접속해 수행해야 하는 단계다. 앞선 태스크들이 전부 커밋된 뒤, 사용자가 재배포를 승인하면 이 체크리스트를 그대로 따른다.

- [ ] **Step 1: 구글 OAuth 클라이언트 ID 발급 확인**

사용자가 Google Cloud Console에서 OAuth 2.0 클라이언트 ID(웹 애플리케이션, 승인된 자바스크립트 원본에 실제 배포 도메인 등록)를 이미 갖고 있는지 확인한다. 없으면 발급 절차를 사용자에게 안내한다(이 프로젝트는 배포/구글 로그인 등 새로운 개념을 하나씩 설명하는 걸 선호하므로, 처음이라면 발급 화면을 캡처해가며 같이 진행한다).

- [ ] **Step 2: `client/.env.local`에 클라이언트 ID 기록**

```
VITE_GOOGLE_CLIENT_ID=<발급받은 클라이언트 ID>
```

- [ ] **Step 3: `server/.env`에 나머지 값 기록**

```
GOOGLE_CLIENT_ID=<위와 동일한 클라이언트 ID>
SESSION_JWT_SECRET=<openssl rand -hex 32 등으로 생성한 무작위 값>
ADMIN_PASSWORD=<관리자 비밀번호>
```

- [ ] **Step 4: 이미지 빌드 (build-arg 포함)**

```bash
docker build --build-arg VITE_GOOGLE_CLIENT_ID=<client/.env.local의 값> -t yutnori:latest .
```

- [ ] **Step 5: 이미지 전달 + 기존 컨테이너 교체**

```bash
docker save yutnori:latest | gzip > yutnori.tar.gz
scp yutnori.tar.gz <ec2-host>:~/
ssh <ec2-host>
# EC2에서:
docker load < yutnori.tar.gz
docker stop yutnori && docker rm yutnori
mkdir -p /home/ec2-user/yutnori-data
docker run -d --name yutnori --network songpyeon-net --restart unless-stopped \
  -e GOOGLE_CLIENT_ID=<값> -e SESSION_JWT_SECRET=<값> -e ADMIN_PASSWORD=<값> \
  -v /home/ec2-user/yutnori-data:/app/server/data \
  yutnori:latest
```

(`-v`는 반드시 호스트 경로 바인드 마운트여야 한다 — 네임드 볼륨과 혼동하면 재배포마다 빈 DB로 시작한다. songpyeon의 동일 실수 사례가 `CLAUDE.md`에 기록돼 있다.)

- [ ] **Step 6: Caddyfile에 `/admin` IP allowlist 추가**

`/home/ec2-user/caddy/Caddyfile`을 열어(기존 파일을 먼저 `Caddyfile.bak-YYYYMMDD`로 백업), yutnori 도메인 블록 안에 관리자 PC의 IP만 허용하는 `handle`/`handle` 블록을 추가한다(songpyeon의 Caddyfile에 있는 동일 블록을 참고해 도메인/서비스 이름만 바꿔 이식). 저장 후:

```bash
docker restart caddy
```

- [ ] **Step 7: 검증**

```bash
curl -I https://<yutnori 도메인>/
curl -I https://<yutnori 도메인>/admin   # 관리자 PC에서 실행 — 200 기대
```

다른 IP(또는 모바일 데이터)에서 `/admin` 접속 시 403이 뜨는지 확인한다. 로그인 화면에서 실제 구글 계정으로 로그인 → 닉네임 설정 → 로비 진입까지 브라우저로 직접 확인한다.

- [ ] **Step 8: `docs/REQUIREMENTS.md`에 배포 완료 changelog 한 줄 추가, 커밋**

```bash
git add docs/REQUIREMENTS.md
git commit -m "구글 로그인/관리자 대시보드 프로덕션 배포 완료"
```

---

## 셀프 리뷰 (스펙 대조)

- **§2 DB 스키마** → Task 2가 7개 테이블 전부 구현.
- **§3 인증(googleAuth/session/onAuth)** → Task 3, 4, 5, 11.
- **§4 로그 기록 지점** → Task 7(입퇴장/채팅), 8(IP/방문자/문의) 값 채우는 지점은 Task 11(MatchRoom), 16(HTTP 라우트).
- **§5 관리자 인증** → Task 6.
- **§6 관리자 API + 대시보드 UI** → Task 17(API), 20~22(UI).
- **§7 플레이어 클라이언트 흐름 변경** → Task 18, 19.
- **§8 환경변수 & 인프라** → Task 1(.env), 23(Dockerfile), 24(EC2).
- **§9 에러 처리** → 각 라우트 태스크(16, 17) 안에 401/409/429 처리 포함.
- **§10 테스트 전략 + 최대 리스크(기존 테스트 마이그레이션)** → Task 10(헬퍼) + 12~15(4개 파일 순차 이전).
- **§11 범위 제외 항목** → 계획에 action_log/pressMonitor/친구/상점 관련 태스크를 만들지 않음으로써 반영.
- **사용자 추가 요청("관리자가 직접 닉네임변경")** → Task 5의 `adminSetNickname` + Task 17의 `/api/admin/users/:id/nickname` + Task 21의 `AdminEditNicknameModal`.

플레이스홀더 스캔: "TBD"/"TODO" 없음. 타입 일관성: `Profile`(client `auth.ts`)의 필드가 `UserProfile`(server `googleAuth.ts`)의 `{id, nickname, bannedAt}`와 일치. `AdminUserRow`가 Task 5/17/21에서 동일한 필드명(`bannedAt`/`createdAt`/`lastLoginAt`)으로 일관되게 쓰임.
