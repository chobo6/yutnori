# 구글 로그인 + 관리자 대시보드 + DB 로그 — 설계 문서

**작성일**: 2026-08-29
**참고**: `songpyeon` 프로젝트(`c:\Users\hong\OneDrive\Desktop\workspace\songpyeon`)의 동일 기능을 그대로 참고하되, yutnori에 없는 기능(친구, 상점, 닉네임 효과, 듀오 게시판, 특정 유저 행동 감시 로그, 실시간 입력 모니터링)은 제외하고 필요한 부분만 이식한다.

## 1. 배경과 목표

yutnori는 현재 DB가 전혀 없고, 닉네임도 매 세션 클라이언트가 자유 입력하는 방식이다(계정 개념 없음). 이 작업은 다음을 추가한다:

1. 구글 로그인 — **로그인이 필수**가 된다(로그인 없이 플레이하는 익명 경로는 없앤다).
2. 계정당 닉네임 고정 — 최초 로그인 시 1회 설정, 이후 관리자만 변경 가능.
3. 관리자 대시보드(`/admin`) — 유저/방 모니터링, 밴, 채팅 로그, 계정별 IP 이력, 일일 방문자 집계, 문의함, 닉네임 강제 변경.
4. 위 전부를 지원하는 SQLite DB 스키마와 로깅 지점.

## 2. DB 스키마 (`server/src/db/connection.ts`)

`better-sqlite3` 단일 파일, WAL 모드 — songpyeon과 동일한 방식(`db.pragma("journal_mode = WAL")`, `synchronous = NORMAL`). DB 파일 경로는 `process.env.SQLITE_DB_PATH ?? "data/yutnori.db"`.

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  nickname TEXT,
  banned_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
-- SQLite UNIQUE 인덱스는 NULL끼리 서로 충돌하지 않으므로, 닉네임 미설정 계정끼리는
-- 문제 없다 — 실제 닉네임 두 개가 같을 때만 막힌다(songpyeon과 동일 근거).

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,          -- 'join' | 'leave' | 'spectate_join' | 'spectate_leave'
  timestamp INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  room_id TEXT NOT NULL,
  room_title TEXT NOT NULL,
  ip TEXT NOT NULL,
  session_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
-- DB 오픈 시점(서버 시작 1회)에 90일 지난 행 삭제. 매 이벤트마다 DELETE하지 않는다
-- (songpyeon과 동일 이유 — 단일 프로세스가 모든 방을 처리하므로 매 입장/퇴장마다
-- 동기 디스크 쓰기가 하나 더 늘면 다른 방 처리까지 지연될 수 있음).

CREATE TABLE IF NOT EXISTS chat_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS user_ips (
  user_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  first_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  PRIMARY KEY (user_id, ip)
);
-- 무기한 보관(계정 조사 목적) — events/daily_visit_log의 90일 자동 삭제 대상 아님.

CREATE TABLE IF NOT EXISTS daily_visit_log (
  date TEXT NOT NULL,
  visitor_key TEXT NOT NULL,   -- 로그인 필수라 항상 "user:<id>" 형태
  PRIMARY KEY (date, visitor_key)
);
-- 쓰기 시점마다 90일 지난 행 삭제(songpyeon과 동일).

CREATE TABLE IF NOT EXISTS inquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nickname TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nickname_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  old_nickname TEXT,
  new_nickname TEXT NOT NULL,
  source TEXT NOT NULL,        -- 'initial' | 'admin'
  changed_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);
CREATE INDEX IF NOT EXISTS idx_nickname_history_user ON nickname_history(user_id, id);
```

**songpyeon 대비 의도적으로 뺀 것**: `friendships`, `direct_messages`, `chat_read_state`, `owned_nickname_effects`, `duo_listings`, `action_log`(특정 유저 감시 로그) — yutnori에 해당 기능이 없거나 이번 스코프에서 요청되지 않음.

## 3. 인증 (`server/src/auth/`)

### 3.1 `googleAuth.ts`

- `verifyGoogleIdToken(credential)`: `google-auth-library`의 `OAuth2Client.verifyIdToken`으로 검증, `{ sub, email, name }` 반환. `audience`(=`GOOGLE_CLIENT_ID`)가 없으면 명시적으로 실패시킨다(songpyeon과 동일 — 없으면 라이브러리가 aud 클레임 검증 자체를 건너뛰어 다른 앱용 토큰도 통과해버림).
- `getOrCreateUser(googleSub, { email, name })`: `google_sub` 기준 조회 후 없으면 INSERT, 있으면 `email`/`name`/`last_login_at` UPDATE. 닉네임은 로그인 시점에 절대 건드리지 않는다(신규 계정만 `nickname IS NULL`로 남음).
- `setNickname(userId, nickname)`: 닉네임이 아직 없는 계정에만 설정(최초 1회). 결과: `"ok" | "already_set" | "taken"`. 성공 시 `nickname_history`에 `source: "initial"`로 기록.
- `adminSetNickname(userId, nickname)`: 관리자 전용 — 이미 설정된 닉네임도 덮어쓴다. 결과: `"ok" | "taken"`. 성공 시 `nickname_history`에 `source: "admin"`로 기록.
- `getUserById(userId)`, `listUsers({ offset, limit })`(페이지네이션), `setUserBanned(userId, banned)`, `touchLastLogin(userId)`.
- `sanitizeNickname`은 기존 `server/src/game/nickname.ts`를 그대로 재사용한다(새로 안 만듦).

### 3.2 `session.ts`

songpyeon과 동일하게 이식: `signSession(userId)`(JWT, `SESSION_JWT_SECRET`, 30일 만료), `verifySession(token)`, `getCookieValue(cookieHeader, name)`(WS 업그레이드 요청은 Express의 `cookie-parser`를 안 거치므로 직접 파싱해야 함), `SESSION_COOKIE_NAME = "session"`.

### 3.3 인증 라우트 (`createServer.ts`에 추가)

- `POST /api/auth/google` — body의 `credential` 검증 → `getOrCreateUser` → 세션 쿠키 발급(`httpOnly`, `secure`(프로덕션), `sameSite: "lax"`) → `recordUserIp`, `recordVisit` 호출 → 프로필 반환.
- `GET /api/auth/me` — 세션 검증 → 없으면 401 → 있으면 `touchLastLogin` + `recordUserIp` + 프로필 반환.
- `POST /api/auth/nickname` — `setNickname` 호출, 결과에 따라 200/409.
- `POST /api/auth/logout` — 쿠키 삭제.
- `POST /api/inquiries` — 로그인 필요, `recordInquiry` 호출.
- `GET /api/rooms`(기존 공개 방 목록) — **로그인 필수 정책에 맞춰 이것도 세션 검증을 추가한다**(미검증 시 401). "로그인 없이 할 수 있는 건 로그인 화면 자체뿐"으로 통일하는 게 이번 요청의 취지에 맞다.

### 3.4 `MatchRoom.onAuth` (신규)

yutnori의 `MatchRoom`에는 현재 `onAuth`가 아예 없다(닉네임을 `onJoin`의 `options.nickname`으로 그냥 받음). 다음과 같이 신규 추가:

```ts
async onAuth(_client: Client, _options: unknown, context: AuthContext) {
  const token = getCookieValue(context.headers?.cookie, SESSION_COOKIE_NAME);
  const userId = verifySession(token);
  const user = userId ? getUserById(userId) : undefined;
  if (!user || !user.nickname) throw new Error("로그인이 필요합니다.");
  if (user.bannedAt) throw new Error("이용이 제한된 계정입니다.");
  return { ip: context.ip, userId: user.id, nickname: user.nickname };
}
```

`onJoin`은 더 이상 `options?.nickname`을 안 받고 `client.auth.nickname`/`client.auth.userId`를 쓴다. 재접속(`allowReconnection`)은 `onAuth`를 다시 안 타므로, songpyeon과 동일하게 재접속 성공 직후 최신 밴 상태를 다시 조회해서 막는 처리가 필요하다(`docs/TROUBLESHOOTING.md`에 이 패턴이 정리돼 있다면 그대로 재사용).

## 4. 로그 기록 지점

- **입장/퇴장/관전 로그** (`server/src/admin/eventLog.ts`): `MatchRoom.onJoin`(플레이어로 들어오면 `"join"`, 관전자면 `"spectate_join"`)/`onLeave`(각각 `"leave"`/`"spectate_leave"`)에서 `recordEvent()` 호출. IP는 `client.auth.ip`.
- **채팅 로그** (`server/src/admin/chatLog.ts`): `sendChat` 메시지 핸들러(`MatchRoom.ts:146`)에서 브로드캐스트 직전에 `recordChatLog(nickname, text)` 호출 — nickname은 `client.auth.nickname`(더 이상 클라이언트가 보내는 값이 아니라 서버가 아는 계정 닉네임).
- **계정별 IP 이력** (`server/src/admin/userIps.ts`): `/api/auth/me` 호출마다 `recordUserIp(userId, ip)`.
- **일일 방문자 집계** (`server/src/admin/dailyVisits.ts`): `/api/auth/me` 호출마다 `recordVisit(userId)` — 로그인이 필수라 songpyeon처럼 `ip:<IP>` 방문자 키 분기가 필요 없다(항상 `user:<id>`).
- **문의** (`server/src/admin/inquiries.ts`): `POST /api/inquiries`에서 `recordInquiry()`.

## 5. 관리자 인증 (`server/src/admin/auth.ts`, `loginRateLimit.ts`)

songpyeon과 동일하게 이식:

- `checkPassword(password)`: `ADMIN_PASSWORD` 환경변수와 `timingSafeEqual`(SHA-256 고정 길이 비교)로 검증.
- `createSession()`/`isValidSession(token)`/`destroySession(token)`: 인메모리 토큰 맵, TTL 12시간(`SESSION_TTL_MS`).
- `requireAdmin` Express 미들웨어: `admin_session` 쿠키 검증, 실패 시 401.
- `loginRateLimit.ts`: IP별 15분 윈도우에 5회 실패 시 잠금(`isRateLimited`/`recordFailedAttempt`/`recordSuccessfulLogin`).
- 라우트: `POST /api/admin/login`(비번+레이트리밋 체크 후 세션 쿠키 발급), `POST /api/admin/logout`.

세션은 songpyeon과 동일하게 **인메모리**라 서버 재시작 시 초기화된다(의도된 동작 — 로그인만 다시 하면 됨).

## 6. 관리자 API + 대시보드 UI

모든 `/api/admin/*`는 `requireAdmin` 미들웨어를 거친다.

| 라우트 | 설명 |
|---|---|
| `GET /api/admin/rooms` | 활성 방/인원 (matchMaker.query 재사용, 기존 `/api/rooms`와 동일 데이터) |
| `GET /api/admin/events` | 최근 입장/퇴장 최대 100건 |
| `GET /api/admin/events/search?nickname=` | 닉네임 부분일치로 과거 접속기록 검색(최대 200건) |
| `GET /api/admin/chat-logs` | 최근 채팅 로그 최대 200건 |
| `GET /api/admin/stats/daily-visitors` | 오늘 방문자 수 + 최근 7일 |
| `GET /api/admin/users?offset=&limit=` | 유저 목록(페이지네이션) |
| `POST /api/admin/users/:id/ban` | 밴/해제 토글 |
| `POST /api/admin/users/:id/nickname` | 관리자 닉네임 강제 변경(`adminSetNickname`) |
| `GET /api/admin/users/:id/ips` | 계정별 IP 이력 |
| `GET /api/admin/inquiries` | 문의 목록 |
| `POST /api/admin/announce` | 공지 배너 발송(SSE) |
| `GET /api/announcements/stream` | 공지 배너 구독(SSE, 인증 불필요 — 일반 유저용) |

**클라이언트 컴포넌트** (`client/src/components/`, songpyeon 구조 재사용):

- `AdminPage.tsx` — 로그인 여부 + 뷰 전환(대시보드/유저관리/문의함), 라우터 없이 `useState`로 분기.
- `AdminLogin.tsx` — 비밀번호 입력 폼.
- `AdminDashboard.tsx` — 활성 방/인원, 최근 입장·퇴장, 최근 채팅 로그, 닉네임 검색, 오늘 방문자 수, 공지 배너 발송 폼.
- `AdminUsers.tsx` — 유저 목록(페이지네이션) + 행마다 밴/해제 버튼 + "닉네임 수정" 버튼.
- `AdminEditNicknameModal.tsx` — 닉네임 입력 필드 하나짜리 간단한 모달(songpyeon의 `AdminEditUserModal`처럼 색/효과/게임머니까지 다 들어간 건 불필요 — 닉네임 하나만).
- `AdminInquiries.tsx` — 문의 목록 열람.
- 진입: `main.tsx`가 `window.location.pathname === "/admin"`으로 분기(라우터 라이브러리 안 씀, songpyeon과 동일).

## 7. 플레이어 클라이언트 흐름 변경

- `client/src/game/auth.ts` (신규, songpyeon과 거의 동일): `renderGoogleButton`(Google Identity Services 스크립트 직접 로드), `loginWithGoogle`, `fetchMe`, `submitNickname`, `logout`.
- `App.tsx` 최상단 분기: 앱 로드 시 `fetchMe()` 호출 → (1) 실패/null → `GoogleLoginScreen` 표시, (2) 로그인 됐지만 `nickname === null` → 닉네임 설정 화면(기존 닉네임 입력 UI를 재활용하되 "계정에 영구 저장됨" 문구 추가), (3) 닉네임까지 있음 → 기존 로비/게임 화면. 기존에 매 세션 닉네임을 입력받던 진입 화면은 이 로그인 플로우로 완전히 대체된다.
- 로비에 로그아웃 버튼 + "문의하기" 버튼(간단한 제목/내용 폼 모달) 추가.
- Colyseus `joinOrCreate` 호출부에서 더 이상 `{ nickname }`을 옵션으로 안 보낸다 — 서버가 세션 쿠키로 알아서 식별한다. **단, Colyseus WS 연결도 same-origin 쿠키가 자동으로 실려가는지 확인 필요**(브라우저 기본 동작상 실리지만, dev 환경에서 client(5173)/server(2567) 오리진이 다르면 `npm run sync-public`으로 같은 오리진에서 테스트해야 한다 — songpyeon의 기존 Gotcha와 동일).

## 8. 환경변수 & 인프라

- 서버: `GOOGLE_CLIENT_ID`, `SESSION_JWT_SECRET`, `ADMIN_PASSWORD`, `SQLITE_DB_PATH`(선택) — `server/.env`(dotenv, git 미포함).
- 클라이언트 빌드: `VITE_GOOGLE_CLIENT_ID` — `client/.env.local`(git 미포함), Docker 빌드 시 `--build-arg`로 주입.
- `Dockerfile`: `ARG VITE_GOOGLE_CLIENT_ID` 추가, `ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID` 후 클라이언트 빌드.
- EC2 `docker run`: `-e GOOGLE_CLIENT_ID=... -e SESSION_JWT_SECRET=... -e ADMIN_PASSWORD=... -v /home/ec2-user/yutnori-data:/app/server/data` 추가(바인드 마운트 — 네임드 볼륨과 혼동 주의, songpyeon Gotcha와 동일 위험).
- EC2 Caddyfile: `/admin`, `/api/admin/*` 경로를 관리자 PC IP로 제한하는 블록 추가(`handle`/`handle` 명시적 순서 패턴, songpyeon과 동일). **실제 파일은 EC2 호스트에 있어 구현 단계에서 SSH로 직접 편집**(리포에는 없음).

## 9. 에러 처리

- 구글 토큰 검증 실패 → `/api/auth/google` 401, 클라이언트는 로그인 화면에 에러 메시지 표시.
- 세션 만료/없음 → `/api/auth/me` 401 → 클라이언트가 로그인 화면으로 리셋.
- 밴된 계정 → `MatchRoom.onAuth`에서 join 거부(에러 메시지를 클라이언트가 그대로 보여줌). HTTP API 레벨에서는 밴이 로그인 자체를 막지 않는다(로그인/방목록 열람은 허용, 매치 입장만 차단 — songpyeon과 동일 정책).
- 닉네임 중복 → `setNickname`/`adminSetNickname`이 `"taken"` 반환 → 409.
- 관리자 로그인 실패 5회 → 15분 잠금, 423 또는 429로 응답.

## 10. 테스트 전략

기존 프로젝트 컨벤션(TDD, 순수 함수 + `*.test.ts`)을 그대로 따른다.

- `server/src/db/connection.test.ts` — 신규 DB 생성 시 테이블/인덱스 존재 확인.
- `server/src/auth/googleAuth.test.ts` — `getOrCreateUser`/`setNickname`/`adminSetNickname`/`setUserBanned` 등 순수 DB 로직(구글 토큰 검증 자체는 목킹).
- `server/src/auth/session.test.ts` — JWT 서명/검증/쿠키 파싱.
- `server/src/admin/*.test.ts` — `eventLog`/`chatLog`/`userIps`/`dailyVisits`/`inquiries`/`auth`/`loginRateLimit` 각각.
- **`MatchRoom.*.test.ts` 4개 파일 전부 영향받음**: `onAuth`가 로그인 세션을 요구하므로, 기존 `colyseus.connectTo(room)` 호출이 전부 깨진다. 구현 계획에서 테스트 헬퍼(예: 테스트 전용으로 세션 토큰을 미리 발급해 `connectTo`에 쿠키 형태로 주입하는 유틸, 또는 `@colyseus/testing`이 지원하는 방식 확인 후 그에 맞는 우회)를 먼저 만들고 그 위에 기존 테스트들을 순차 이전해야 한다. 이 부분이 이번 작업에서 가장 손이 많이 가는 지점이다.
- 클라이언트: `npm run build`로 타입체크, Playwright로 로그인→닉네임설정→로비→게임 골든 패스와 관리자 페이지 골든 패스 수동 검증.

## 11. 범위에서 제외한 것 (명시적으로 안 함)

- 특정 유저 행동 감시 로그(`action_log`, songpyeon의 조사용 기능) — 요청 없었음.
- 실시간 입력 모니터링(`pressMonitor`) — yutnori는 턴제 게이지 게임이라 연타 부정행위 감지 필요성이 낮고, 요청도 없었음.
- 로그인 없는 익명 플레이 — 이번 요청으로 완전히 제거됨(기존에도 없었음, 새로 안 만듦).
- 닉네임 색상/효과/파티클, 게임머니, 상점 — songpyeon 전용 기능, yutnori 스코프 아님.
