# 방 만들기/입장 로비 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `client.joinOrCreate("match")` 자동 매칭을 없애고, 닉네임 입력 → 방 목록(로비) → 방 만들기/입장 흐름으로 바꾼다.

**Architecture:** 서버는 방 생성 시점에 모드(2v2/1v1)와 `maxClients`를 확정하며 게임 시작 시 명시적으로 방을 잠근다(`this.lock()`). 클라이언트는 `joinMatch()`(자동 매칭) 대신 `listRooms()`/`createRoom()`/`joinRoom()` 세 함수로 바뀌고, `useMatchRoom`은 "방을 얻는 것"과 "얻은 방을 구독하는 것"의 책임이 분리된다. 닉네임은 순수 클라이언트 값(localStorage)이며 서버는 표시에만 쓴다.
>
> **Task 3 실행 중 정정(2026-08-24):** 설계 당시 "Colyseus 내장 `client.getAvailableRooms()`"를 전제했으나, 실제 설치된 `colyseus.js` 버전(0.16.22)에는 이 메서드가 존재하지 않는다(타입 정의로 직접 확인 — `create`/`join`/`joinById`/`reconnect`/`consumeSeatReservation`만 있음). songpyeon도 동일 버전대에서 같은 문제를 겪었고 이미 `matchMaker.query()` 기반 `/api/rooms` 커스텀 엔드포인트로 해결해뒀다(`songpyeon/server/src/createServer.ts`, 주석: "colyseus.js 0.16.x has no client.getAvailableRooms() — this app-level route replaces it"). 이 프로젝트도 동일 패턴을 그대로 이식했다 — 아래 Global Constraints와 Task 3 Step 1의 "REST 엔드포인트를 만들지 않는다"는 문구는 이 사실 확인 이전의 잘못된 전제였다.

**Tech Stack:** React 19 + TypeScript(client), Colyseus(server, `@colyseus/schema`), Vitest(server 테스트), npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-24-room-lobby-design.md`

## Global Constraints

- **client에는 자동화 테스트 프레임워크가 없다** — client 태스크의 검증은 `cd client && npm run build`(타입체크) + 마지막 통합 태스크의 실제 브라우저 확인으로 한다.
- **server 로직은 TDD로**(기존 관례) — `server/src/game/*`의 순수 함수는 테스트 먼저 작성.
- **방 목록은 `matchMaker.query()` 기반 `/api/rooms` 엔드포인트로 제공한다**(당초 "Colyseus 내장 `client.getAvailableRooms()`"를 쓰려 했으나 설치된 `colyseus.js` 0.16.22에는 해당 메서드가 없음이 Task 3 실행 중 확인됨 — 위 Architecture 절의 정정 참고, songpyeon과 동일 패턴).
- **닉네임 정제 최대 길이 12자**, **방 제목 정제 최대 길이 20자**(songpyeon의 `roomTitle.ts`와 동일 길이) — 둘 다 `input.trim().slice(0, MAX)`, 빈 문자열이면 호출부가 폴백을 채운다.
- **게임 시작 시(`maybeStartGame`이 `phase`를 `"playing"`으로 바꾸는 지점) 반드시 `this.lock()`을 호출한다** — Colyseus의 `maxClients` 기반 자동 잠금은 클라이언트가 나가면 자동으로 풀리므로, 명시적으로 잠그지 않으면 진행 중인 방이 로비 목록에 다시 나타난다.
- **`pickMode` 메시지는 완전히 삭제한다** — 모드는 방 생성 시(`onCreate` options)에만 정해진다. 기존 `MatchRoom.test.ts`의 `pickMode` 관련 테스트는 Task 2에서 정리한다.
- 커밋 메시지는 한국어, `feat:`/`fix:` 같은 프리픽스 없이.

---

### Task 1: 닉네임 정제 순수 함수 (server + client)

**Files:**
- Create: `server/src/game/nickname.ts`
- Test: `server/src/game/nickname.test.ts`
- Create: `client/src/game/nickname.ts`

**Interfaces:**
- Produces(server): `export function sanitizeNickname(input: unknown): string`
- Produces(client): `export function getStoredNickname(): string | null`, `export function setStoredNickname(value: string): void`

- [ ] **Step 1: 서버 정제 함수의 실패하는 테스트 작성**

```ts
// server/src/game/nickname.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeNickname } from "./nickname";

describe("sanitizeNickname", () => {
  it("공백을 앞뒤로 정리한다", () => {
    expect(sanitizeNickname("  홍길동  ")).toBe("홍길동");
  });

  it("12자를 넘으면 잘라낸다", () => {
    expect(sanitizeNickname("가나다라마바사아자차카타파하")).toBe("가나다라마바사아자차카타");
  });

  it("문자열이 아니면 빈 문자열을 반환한다", () => {
    expect(sanitizeNickname(undefined)).toBe("");
    expect(sanitizeNickname(null)).toBe("");
    expect(sanitizeNickname(42)).toBe("");
  });

  it("공백만 있으면 빈 문자열이 된다", () => {
    expect(sanitizeNickname("   ")).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/nickname.test.ts`
Expected: FAIL — `nickname.ts` 파일이 없어서 임포트 에러.

- [ ] **Step 3: 서버 정제 함수 구현**

```ts
// server/src/game/nickname.ts
const MAX_NICKNAME_LENGTH = 12;

// 빈 문자열/유효하지 않은 입력은 "" 반환 — 호출부(MatchRoom.onJoin)가 문맥에 맞는
// 기본값("플레이어")을 채운다. songpyeon의 roomTitle.ts와 동일한 패턴.
export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_NICKNAME_LENGTH);
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/nickname.test.ts`
Expected: PASS (4개 테스트 전부).

- [ ] **Step 5: 클라이언트 localStorage 헬퍼 작성**

```ts
// client/src/game/nickname.ts
const STORAGE_KEY = "yutnori:nickname";

export function getStoredNickname(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function setStoredNickname(value: string): void {
  localStorage.setItem(STORAGE_KEY, value);
}
```

- [ ] **Step 6: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과.

- [ ] **Step 7: 커밋**

```bash
git add server/src/game/nickname.ts server/src/game/nickname.test.ts client/src/game/nickname.ts
git commit -m "닉네임 정제 순수 함수 추가"
```

---

### Task 2: 서버 — 방 생성 시 모드 확정, 닉네임 저장, 자동 잠금 해제 방지

**Files:**
- Create: `server/src/game/roomTitle.ts`
- Test: `server/src/game/roomTitle.test.ts`
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Modify: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `sanitizeNickname`(Task 1, `../game/nickname`).
- Produces: `export function sanitizeRoomTitle(input: unknown): string`(`server/src/game/roomTitle.ts`). `PlayerState.nickname: string`(스키마 필드, Task 6의 client `matchTypes.ts`가 손으로 미러링할 대상). `MatchRoom.onCreate`가 이제 `{ title?: string; mode?: "2v2"|"1v1"; ... }` 옵션을 받고, 방 시작 시 `this.locked === true`가 된다.

- [ ] **Step 1: 방 제목 정제 함수 — 실패하는 테스트 작성**

```ts
// server/src/game/roomTitle.test.ts
import { describe, expect, it } from "vitest";
import { sanitizeRoomTitle } from "./roomTitle";

describe("sanitizeRoomTitle", () => {
  it("공백을 앞뒤로 정리한다", () => {
    expect(sanitizeRoomTitle("  즐거운 한판  ")).toBe("즐거운 한판");
  });

  it("20자를 넘으면 잘라낸다", () => {
    const long = "가".repeat(25);
    expect(sanitizeRoomTitle(long)).toBe("가".repeat(20));
  });

  it("문자열이 아니거나 빈 값이면 빈 문자열을 반환한다", () => {
    expect(sanitizeRoomTitle(undefined)).toBe("");
    expect(sanitizeRoomTitle("   ")).toBe("");
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/roomTitle.test.ts`
Expected: FAIL — 파일 없음.

- [ ] **Step 3: 방 제목 정제 함수 구현**

```ts
// server/src/game/roomTitle.ts
const MAX_ROOM_TITLE_LENGTH = 20;

// 빈 문자열/유효하지 않은 입력은 "" 반환 — 호출부(MatchRoom.onCreate)가 "이름 없는 방" 같은
// 기본값을 채운다.
export function sanitizeRoomTitle(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_ROOM_TITLE_LENGTH);
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/roomTitle.test.ts`
Expected: PASS (3개 테스트 전부).

- [ ] **Step 5: `MatchState.ts`에 `nickname` 필드 추가**

`server/src/rooms/MatchState.ts`의 `PlayerState` 클래스(현재 5-9번째 줄)를 다음으로 교체:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") team: string = ""; // "A" | "B" | ""
  @type("boolean") ready: boolean = false;
  @type(["string"]) characters = new ArraySchema<string>();
}
```

- [ ] **Step 6: `MatchRoom.ts` — `onCreate`/`onJoin` 변경**

`server/src/rooms/MatchRoom.ts` 상단에 임포트 추가(4번째 줄 `MatchState` 임포트 다음 줄에):

```ts
import { sanitizeNickname } from "../game/nickname";
import { sanitizeRoomTitle } from "../game/roomTitle";
```

`maxClients = 4;` 필드 선언(현재 14번째 줄)을 삭제 — `onCreate`에서 모드별로 정한다.

`onCreate` 시그니처와 본문 맨 앞부분(현재 28-33번째 줄)을 다음으로 교체:

```ts
async onCreate(options?: {
  title?: string;
  mode?: "2v2" | "1v1";
  throwTimeoutMs?: number;
  moveTimeoutMs?: number;
  rng?: Rng;
}) {
  this.setState(new MatchState());

  const mode = options?.mode === "1v1" ? "1v1" : "2v2";
  this.state.mode = mode;
  this.maxClients = mode === "1v1" ? 2 : 4;

  const title = sanitizeRoomTitle(options?.title) || "이름 없는 방";
  // matchMaker가 onCreate의 반환(Promise)을 기다려주므로, 방 생성 직후 바로
  // getAvailableRooms()/테스트에서 메타데이터를 조회해도 항상 최신 값이 보이도록 await한다.
  await this.setMetadata({ title, mode });

  if (typeof options?.throwTimeoutMs === "number") this.throwTimeoutMs = options.throwTimeoutMs;
  if (typeof options?.moveTimeoutMs === "number") this.moveTimeoutMs = options.moveTimeoutMs;
  if (typeof options?.rng === "function") this.rng = options.rng;
```

(이 뒤에 이어지는 `this.onMessage("pickTeam", ...)`부터는 그대로 유지 — 딱 이 시그니처와 앞부분만 바꾼다.)

`onMessage("pickMode", ...)` 핸들러 전체(현재 42-47번째 줄)를 삭제:

```ts
    this.onMessage("pickMode", (client, message: { mode: "2v2" | "1v1" } | undefined) => {
      if (this.state.phase !== "waiting") return;
      if (message?.mode !== "2v2" && message?.mode !== "1v1") return;
      this.state.mode = message.mode;
      this.maybeStartGame();
    });
```

`onJoin`(현재 98-102번째 줄)을 다음으로 교체:

```ts
onJoin(client: Client, options?: { nickname?: string }) {
  const player = new PlayerState();
  player.sessionId = client.sessionId;
  player.nickname = sanitizeNickname(options?.nickname) || "플레이어";
  this.state.players.set(client.sessionId, player);
}
```

`maybeStartGame()` 안에서 `this.state.phase = "playing";`을 설정하는 줄(현재 167번째 줄) 바로 다음 줄에 `this.lock();`을 추가:

```ts
    this.state.phase = "playing";
    this.lock(); // maxClients 자동 잠금은 플레이어 이탈 시 풀리므로 명시적으로 잠가야 한다
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
```

- [ ] **Step 7: `MatchRoom.test.ts`에서 `pickMode`를 쓰던 테스트 정리**

`pickMode`가 등장하는 8곳을 정리한다. 먼저 **테스트 2개를 완전히 삭제**한다(더 이상 존재하지 않는 메시지 자체를 검증하던 테스트라 대체할 게 없음) — `"pickMode로 모드를 바꿀 수 있다"`와 `"잘못된 mode 값은 무시된다"` 두 `it(...)` 블록을 통째로 삭제:

```ts
  it("pickMode로 모드를 바꿀 수 있다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    expect(room.state.mode).toBe("2v2");
    client.send("pickMode", { mode: "1v1" });
    await flush();
    expect(room.state.mode).toBe("1v1");
  });

  it("잘못된 mode 값은 무시된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const client = await colyseus.connectTo(room);

    client.send("pickMode", { mode: "3v3" });
    await flush();
    expect(room.state.mode).toBe("2v2");
  });
```

나머지 6곳 중 5곳은 "1v1 모드로 전환하려고 `pickMode`를 보내던" 설정 단계다 — `createRoom("match", {})` + `send("pickMode", {mode:"1v1"})` 두 줄을 `createRoom("match", { mode: "1v1" })` 한 줄로 바꾸고 `pickMode` 전송/flush 줄은 삭제한다(나머지 1곳은 항목 2에서 보듯 삭제 대상). 아래 항목들을 정확히 이렇게 바꾼다(각각 함수 시작 부분의 `const room = ...`/`const roomOrClientA = ...` 줄과, 그 아래 `pickMode` 전송+`await flush()` 두 줄이 대상):

1. `"1v1 모드에서는 2명(팀당 1명)이 캐릭터 4종씩 고르고 준비하면..."` 테스트:
```ts
    // 변경 전
    const room = await colyseus.createRoom<MatchState>("match", {});
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    clientA.send("pickMode", { mode: "1v1" });
    await flush();

    clientA.send("pickTeam", { team: "A" });
```
```ts
    // 변경 후
    const room = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    const clientA = await colyseus.connectTo(room);
    const clientB = await colyseus.connectTo(room);

    clientA.send("pickTeam", { team: "A" });
```

2. `"1v1 모드에서 한 팀에 2명이 들어와 인원이 안 맞으면..."` 테스트: **삭제한다.** 이 테스트는 클라이언트 3명을 연결해 그중 팀 분배를 어긋나게 만드는데, 이제 1v1 방은 생성 시점에 `maxClients=2`로 고정되므로 3번째 클라이언트의 `connectTo` 자체가 매치메이커에 의해 "room is locked"로 거부된다(실행해보면 실제로 이 에러로 실패한다) — 테스트가 검증하려던 것(인원 불일치 시 시작 안 함)보다 더 근본적인 방식으로 애초에 3명이 들어올 수 없게 되어 테스트 자체가 성립하지 않는다. 바로 다음 테스트("1v1 모드에서 두 명 다 같은 팀을 고르면...")가 정확히 2명으로 팀 불일치를 만드는 동일한 취지의 검증을 이미 하고 있으므로 대체할 필요도 없다.

3. `"1v1 모드에서 두 명 다 같은 팀을 고르면..."` 테스트: 같은 패턴 — `createRoom("match", {})`를 `createRoom("match", { mode: "1v1" })`로, `clientA.send("pickMode", { mode: "1v1" }); await flush();` 두 줄 삭제.

4. `"ready 이후 마지막 조건(pickCharacters)이 채워지면..."` 테스트: 같은 패턴 — `createRoom("match", {})`를 `createRoom("match", { mode: "1v1" })`로, `clientA.send("pickMode", { mode: "1v1" }); await flush();` 두 줄 삭제.

5. `"1v1 모드에서는 캐릭터 4종을 골라야 반영된다(2종은 무시)"` 테스트: 같은 패턴 — `createRoom("match", {})`를 `createRoom("match", { mode: "1v1" })`로, `client.send("pickMode", { mode: "1v1" }); await flush();` 두 줄 삭제.

6. `"1v1 모드에서는 캐릭터 중복이 허용된다"` 테스트: 같은 패턴 — `createRoom("match", {})`를 `createRoom("match", { mode: "1v1" })`로, `client.send("pickMode", { mode: "1v1" }); await flush();` 두 줄 삭제.

이 6곳 모두 `mode`를 옵션으로 넘기므로, `MatchRoom.onCreate`가 `options.mode`를 읽어 `this.state.mode`를 그 즉시 `"1v1"`로 설정하는 Step 6의 변경과 맞물려 동일하게 동작한다.

`setupFourPlayers` 헬퍼(파일 최상단)와 이를 쓰는 2v2 테스트들은 `createRoom("match", options)`를 그대로 두면 된다(옵션 없음 → 기본값 `"2v2"`).

- [ ] **Step 8: 새 동작에 대한 테스트 추가**

같은 파일(`server/src/rooms/MatchRoom.test.ts`) `describe("MatchRoom", ...)` 블록 안, 기존 테스트들 사이 아무 곳에나 다음 4개 `it`을 추가:

```ts
  it("mode에 따라 maxClients가 정해진다", async () => {
    const room2v2 = await colyseus.createRoom<MatchState>("match", {});
    expect(room2v2.maxClients).toBe(4);

    const room1v1 = await colyseus.createRoom<MatchState>("match", { mode: "1v1" });
    expect(room1v1.maxClients).toBe(2);
  });

  it("방 생성 시 title이 메타데이터로 저장된다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", { title: "  즐거운 한판  ", mode: "1v1" });
    expect(room.metadata?.title).toBe("즐거운 한판");
    expect(room.metadata?.mode).toBe("1v1");
  });

  it("title을 안 주면 기본 제목이 붙는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    expect(room.metadata?.title).toBe("이름 없는 방");
  });

  it("입장 시 넘긴 nickname이 정제되어 저장되고, 없으면 기본값이 붙는다", async () => {
    const room = await colyseus.createRoom<MatchState>("match", {});
    const withNickname = await colyseus.connectTo(room, { nickname: "  둘리  " });
    const withoutNickname = await colyseus.connectTo(room, {});
    await flush();

    expect(room.state.players.get(withNickname.sessionId)!.nickname).toBe("둘리");
    expect(room.state.players.get(withoutNickname.sessionId)!.nickname).toBe("플레이어");
  });

  it("게임이 시작되면 방이 잠긴다", async () => {
    const { room } = await setupFourPlayers(colyseus);
    expect(room.locked).toBe(true);
  });
```

- [ ] **Step 9: 서버 전체 테스트 실행**

Run: `cd server && npm test`
Expected: 전체 통과(기존 130여개 + 이번에 추가/수정한 것 포함). `pickMode` 문자열이 더 이상 테스트 파일에 남아있지 않은지 `grep -n "pickMode" server/src/rooms/MatchRoom.test.ts`로도 확인(결과 없어야 함).

- [ ] **Step 10: 커밋**

```bash
git add server/src/game/roomTitle.ts server/src/game/roomTitle.test.ts server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "방 생성 시 모드 확정, 닉네임 저장, 게임 시작 시 방 잠금 추가"
```

---

### Task 3: 클라이언트 — colyseus.ts 재작성 + useMatchRoom 책임 분리

**Files:**
- Modify: `client/src/colyseus.ts`
- Modify: `client/src/game/useMatchRoom.ts`
- Modify: `server/src/createServer.ts`(실행 중 추가 — 위 Architecture 정정 참고: `matchMaker.query()` 기반 `/api/rooms` 라우트)

**Interfaces:**
- Consumes: `MatchState`(`./game/matchTypes`, 기존).
- Produces:
  - `client/src/colyseus.ts`: `export function listRooms(): Promise<RoomAvailable<{ title: string; mode: "2v2" | "1v1" }>[]>`, `export function createRoom(title: string, mode: "2v2" | "1v1", nickname: string): Promise<Room<MatchState>>`, `export function joinRoom(roomId: string, nickname: string): Promise<Room<MatchState>>`. 기존 `joinMatch()`는 삭제.
  - `client/src/game/useMatchRoom.ts`: `export function useMatchRoom(room: Room<MatchState> | null): { state: MatchState | null }` — Task 6이 이 반환값 대신 `room` 자체를 직접 prop으로 넘겨 렌더링하므로, 이 훅의 진짜 역할은 "room의 상태가 바뀔 때마다 컴포넌트를 리렌더시키는 것"이다(반환값은 실질적으로 안 쓰이고 트리거 역할).

- [ ] **Step 1: `colyseus.ts` 전체 교체 — 실행 중 정정된 버전(위 Architecture 절 참고)**

`listRooms()`는 당초 계획대로 `client.getAvailableRooms()`를 쓰지 못하고, 대신 서버에 새로 추가한 `/api/rooms`(songpyeon과 동일 패턴, `matchMaker.query()` 기반)를 `fetch`한다:

```ts
// client/src/colyseus.ts
import { Client, type Room, type RoomAvailable } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";

const wsUrl = import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567";
const client = new Client(wsUrl);

// colyseus.js 0.16.x에는 client.getAvailableRooms()가 없다 — 서버(createServer.ts)가
// matchMaker.query()로 대신 제공하는 /api/rooms를 직접 fetch한다.
const httpUrl = wsUrl.replace(/^ws/, "http");

export async function listRooms(): Promise<RoomAvailable<{ title: string; mode: "2v2" | "1v1" }>[]> {
  const res = await fetch(`${httpUrl}/api/rooms`);
  if (!res.ok) throw new Error(`방 목록 조회 실패: ${res.status}`);
  return res.json();
}

export function createRoom(
  title: string,
  mode: "2v2" | "1v1",
  nickname: string,
): Promise<Room<MatchState>> {
  return client.create<MatchState>("match", { title, mode, nickname });
}

export function joinRoom(roomId: string, nickname: string): Promise<Room<MatchState>> {
  return client.joinById<MatchState>(roomId, { nickname });
}
```

- [ ] **Step 2: `useMatchRoom.ts` 전체 교체**

```ts
// client/src/game/useMatchRoom.ts
import { useEffect, useReducer } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/**
 * 이미 연결된 Room을 받아 상태 변경마다 컴포넌트를 리렌더시키는 훅.
 * "방을 얻는 것"(로비/방 만들기, App.tsx가 담당)과 "얻은 방을 구독하는 것"(이 훅)의
 * 책임을 분리했다 — 예전에는 이 훅이 마운트 시 자동으로 joinMatch()를 호출해 방을
 * 얻는 것까지 함께 했지만, 이제는 로비를 거쳐야 방이 생기므로 그럴 수 없다.
 */
export function useMatchRoom(room: Room<MatchState> | null) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    const handleStateChange = () => {
      if (disposed) return;
      forceRender();
    };
    room.onStateChange(handleStateChange);
    return () => {
      disposed = true;
      room.onStateChange.remove(handleStateChange);
    };
  }, [room]);
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: `App.tsx`가 아직 옛 `useMatchRoom()`(인자 없이 호출) 방식이라 타입 에러가 날 수 있다 — Task 6에서 `App.tsx`를 고치기 전까지는 **정상**이다. 이 에러가 `App.tsx`에서만 나는지 확인하고(다른 새 파일에서 나는 에러는 없어야 함), 있다면 그대로 두고 다음 단계로 진행한다.

- [ ] **Step 4: 커밋**

```bash
git add client/src/colyseus.ts client/src/game/useMatchRoom.ts server/src/createServer.ts
git commit -m "방 목록/생성/입장 함수로 재작성, useMatchRoom을 상태 구독 전용으로 축소, /api/rooms 엔드포인트 추가"
```

---

### Task 4: `NicknameGate` 컴포넌트

**Files:**
- Create: `client/src/components/NicknameGate.tsx`
- Create: `client/src/components/NicknameGate.module.css`

**Interfaces:**
- Consumes: `getStoredNickname`/`setStoredNickname`(Task 1, `../game/nickname`).
- Produces: `export function NicknameGate({ onDone }: { onDone: (nickname: string) => void }): JSX.Element` — 입력 폼 하나. 제출 시 `setStoredNickname(trimmed)` 호출 후 `onDone(trimmed)` 호출.

- [ ] **Step 1: `NicknameGate.module.css` 작성**

```css
/* client/src/components/NicknameGate.module.css */
.wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
}

.input {
  padding: 8px 12px;
  font-size: 1rem;
  border: 1px solid #8a7550;
  border-radius: 6px;
}
```

- [ ] **Step 2: `NicknameGate.tsx` 작성**

```tsx
// client/src/components/NicknameGate.tsx
import { useState, type FormEvent } from "react";
import { setStoredNickname } from "../game/nickname";
import styles from "./NicknameGate.module.css";

export function NicknameGate({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setStoredNickname(trimmed);
    onDone(trimmed);
  }

  return (
    <div className={styles.wrap}>
      <h2>닉네임을 입력하세요</h2>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={12}
          placeholder="닉네임"
          autoFocus
        />
        <button type="submit">시작하기</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: 타입체크**

Run: `cd client && npm run build`
Expected: 새 파일에서 에러 없음(Task 3에서 남은 `App.tsx` 에러는 그대로 있어도 됨).

- [ ] **Step 4: 커밋**

```bash
git add client/src/components/NicknameGate.tsx client/src/components/NicknameGate.module.css
git commit -m "닉네임 입력 화면 추가"
```

---

### Task 5: `RoomList` + `CreateRoomModal` 컴포넌트

**Files:**
- Create: `client/src/components/RoomList.tsx`
- Create: `client/src/components/RoomList.module.css`
- Create: `client/src/components/CreateRoomModal.tsx`
- Create: `client/src/components/CreateRoomModal.module.css`

**Interfaces:**
- Consumes: `listRooms`/`createRoom`/`joinRoom`(Task 3, `../colyseus`).
- Produces: `export function RoomList({ nickname, onRoomJoined }: { nickname: string; onRoomJoined: (room: Room<MatchState>) => void }): JSX.Element` — 2초 폴링 방 목록 + 방 만들기 모달 오픈 버튼. `export function CreateRoomModal({ nickname, onCreated, onClose }: { nickname: string; onCreated: (room: Room<MatchState>) => void; onClose: () => void }): JSX.Element`.

- [ ] **Step 1: `CreateRoomModal.module.css` 작성**

```css
/* client/src/components/CreateRoomModal.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: #fffdf7;
  border-radius: 8px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 280px;
}
```

- [ ] **Step 2: `CreateRoomModal.tsx` 작성**

```tsx
// client/src/components/CreateRoomModal.tsx
import { useState, type FormEvent } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { createRoom } from "../colyseus";
import styles from "./CreateRoomModal.module.css";

export function CreateRoomModal({
  nickname,
  onCreated,
  onClose,
}: {
  nickname: string;
  onCreated: (room: Room<MatchState>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"2v2" | "1v1">("2v2");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const room = await createRoom(title, mode, nickname);
      onCreated(room);
    } catch (err) {
      console.error("방 생성 실패", err);
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>방 만들기</h3>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={20}
          placeholder="방 제목"
          autoFocus
        />
        <div>
          <label>
            <input type="radio" checked={mode === "2v2"} onChange={() => setMode("2v2")} />
            2v2
          </label>
          <label>
            <input type="radio" checked={mode === "1v1"} onChange={() => setMode("1v1")} />
            1v1
          </label>
        </div>
        <button type="submit" disabled={creating}>
          {creating ? "만드는 중..." : "만들기"}
        </button>
        <button type="button" onClick={onClose}>
          취소
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: `RoomList.module.css` 작성**

```css
/* client/src/components/RoomList.module.css */
.wrap {
  max-width: 500px;
  margin: 40px auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border: 1px solid #d9cba8;
  border-radius: 6px;
}
```

- [ ] **Step 4: `RoomList.tsx` 작성**

```tsx
// client/src/components/RoomList.tsx
import { useEffect, useState } from "react";
import type { Room, RoomAvailable } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { joinRoom, listRooms } from "../colyseus";
import { CreateRoomModal } from "./CreateRoomModal";
import styles from "./RoomList.module.css";

type RoomMeta = { title: string; mode: "2v2" | "1v1" };

export function RoomList({
  nickname,
  onRoomJoined,
}: {
  nickname: string;
  onRoomJoined: (room: Room<MatchState>) => void;
}) {
  const [rooms, setRooms] = useState<RoomAvailable<RoomMeta>[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const list = await listRooms();
        if (!cancelled) setRooms(list);
      } catch (err) {
        console.error("방 목록 조회 실패", err);
      }
    }
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleJoin(roomId: string) {
    if (joiningId) return;
    setJoiningId(roomId);
    try {
      const room = await joinRoom(roomId, nickname);
      onRoomJoined(room);
    } catch (err) {
      console.error("방 입장 실패", err);
      setJoiningId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <h2>방 목록</h2>
      <button type="button" onClick={() => setShowCreate(true)}>
        방 만들기
      </button>
      {rooms.length === 0 && <p>열린 방이 없습니다. 방을 만들어보세요!</p>}
      {rooms.map((r) => (
        <div key={r.roomId} className={styles.row}>
          <span>
            {r.metadata?.title ?? "이름 없는 방"} ({r.metadata?.mode ?? "2v2"}) — {r.clients}/{r.maxClients}
          </span>
          <button type="button" disabled={joiningId === r.roomId} onClick={() => handleJoin(r.roomId)}>
            {joiningId === r.roomId ? "입장 중..." : "입장"}
          </button>
        </div>
      ))}
      {showCreate && (
        <CreateRoomModal
          nickname={nickname}
          onCreated={onRoomJoined}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: 타입체크**

Run: `cd client && npm run build`
Expected: 새 파일에서 에러 없음(Task 3에서 남은 `App.tsx` 에러는 그대로 있어도 됨).

- [ ] **Step 6: 커밋**

```bash
git add client/src/components/RoomList.tsx client/src/components/RoomList.module.css client/src/components/CreateRoomModal.tsx client/src/components/CreateRoomModal.module.css
git commit -m "방 목록/방 만들기 화면 추가"
```

---

### Task 6: `App.tsx` 통합 + `WinnerScreen` 로비 복귀 + `playerLabel`/`matchTypes` 닉네임 반영 + 전체 검증

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/WaitingRoom.tsx`
- Modify: `client/src/components/WinnerScreen.tsx`
- Modify: `client/src/game/playerLabel.ts`
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Consumes: `NicknameGate`(Task 4), `RoomList`(Task 5), `useMatchRoom`(Task 3, 새 시그니처), `getStoredNickname`(Task 1).

- [ ] **Step 1: `matchTypes.ts`에 `nickname` 필드 추가**

`client/src/game/matchTypes.ts`의 `PlayerState` 인터페이스(현재 11-16번째 줄)를 다음으로 교체:

```ts
export interface PlayerState {
  sessionId: string;
  nickname: string;
  team: "A" | "B" | "";
  ready: boolean;
  characters: string[];
}
```

- [ ] **Step 2: `playerLabel.ts`가 닉네임을 우선하도록 수정**

`client/src/game/playerLabel.ts` 전체를 다음으로 교체:

```ts
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 닉네임이 있으면 그걸 쓰고, 없으면(이론상 항상 있지만 방어적으로) 팀+세션ID 조각으로 폴백한다. */
export function playerLabel(sessionId: string, room: Room<MatchState>): string {
  const player = room.state.players.get(sessionId);
  if (player?.nickname) return player.nickname;
  const teamLabel = player?.team ? `${player.team}팀 ` : "";
  const isMe = sessionId === room.sessionId;
  return `${teamLabel}${isMe ? "나" : sessionId.slice(0, 4)}`;
}
```

- [ ] **Step 3: `WaitingRoom.tsx`에서 모드 선택 섹션 제거**

`client/src/components/WaitingRoom.tsx`에서 `pickMode` 함수(현재 34-36번째 줄)를 삭제:

```ts
  function pickMode(nextMode: "2v2" | "1v1") {
    room.send("pickMode", { mode: nextMode });
  }
```

"모드 선택" `<section>`(현재 90-106번째 줄)을 통째로 삭제:

```tsx
      <section>
        <h3>모드 선택</h3>
        <button
          type="button"
          className={mode === "2v2" ? styles.selected : undefined}
          onClick={() => pickMode("2v2")}
        >
          2v2
        </button>
        <button
          type="button"
          className={mode === "1v1" ? styles.selected : undefined}
          onClick={() => pickMode("1v1")}
        >
          1v1
        </button>
      </section>
```

(바로 다음에 오는 "팀 선택" `<section>`은 그대로 둔다. `const mode = room.state.mode;`는 이후 캐릭터 선택 분기·필요 인원 계산에 계속 쓰이므로 그대로 둔다.)

- [ ] **Step 4: `WinnerScreen.tsx`에 로비 복귀 버튼 추가**

`client/src/components/WinnerScreen.tsx` 전체를 다음으로 교체:

```tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function WinnerScreen({
  room,
  onLeaveLobby,
}: {
  room: Room<MatchState>;
  onLeaveLobby: () => void;
}) {
  const winner = room.state.players.get(room.state.winnerSessionId);

  function handleLeave() {
    room.leave();
    onLeaveLobby();
  }

  return (
    <div>
      <h2>게임 종료</h2>
      <p>
        {playerLabel(room.state.winnerSessionId, room)}
        {winner?.team ? ` (${winner.team}팀)` : ""}의 승리!
      </p>
      <button type="button" onClick={handleLeave}>
        로비로 돌아가기
      </button>
    </div>
  );
}
```

- [ ] **Step 5: `App.tsx` 전체 교체**

```tsx
// client/src/App.tsx
import { useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";
import { useMatchRoom } from "./game/useMatchRoom";
import { getStoredNickname } from "./game/nickname";
import { NicknameGate } from "./components/NicknameGate";
import { RoomList } from "./components/RoomList";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { WinnerScreen } from "./components/WinnerScreen";
import { ParticipantBar } from "./components/ParticipantBar";
import { ChatInput } from "./components/ChatInput";

function App() {
  const [nickname, setNickname] = useState<string | null>(() => getStoredNickname());
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  useMatchRoom(room);

  if (!nickname) {
    return <NicknameGate onDone={setNickname} />;
  }

  if (!room) {
    return <RoomList nickname={nickname} onRoomJoined={setRoom} />;
  }

  return (
    <div>
      {/* 대기실/플레이/종료 단계와 무관하게 항상 표시 — 채팅 말풍선이 뜰 자리 겸 채팅 입력창. */}
      <ParticipantBar room={room} />

      {room.state.phase === "waiting" && <WaitingRoom room={room} />}

      {room.state.phase === "playing" && <GameBoard room={room} />}

      {room.state.phase === "finished" && (
        <WinnerScreen room={room} onLeaveLobby={() => setRoom(null)} />
      )}

      <ChatInput room={room} />
    </div>
  );
}

export default App;
```

**실행 중 정정:** 위 참고 문구("`GameBoard`가 네 모서리를 스스로 그리므로 `App.tsx`는 `GameBoard` 하나만 렌더링")는 실제 `App.tsx`(2026-08-23 보드 시각화 작업 이후 상태)와 다르다 — 실제로는 `App.tsx`가 `assignCorners`로 계산한 네 모서리에 `PlayerCorner`를 직접 배치하고 `styles.playScreen`/`boardArea` 레이아웃으로 `GameBoard`를 그 안에 끼워 넣는 구조가 그대로 남아 있다. Step 5의 코드를 그대로 덮어쓰면 이 레이아웃이 통째로 사라지므로, 실제 적용본은 위 자동 매칭 관련 부분(닉네임 게이트/로비 라우팅, `WinnerScreen`의 `onLeaveLobby`)만 새로 추가하고 기존 `corners`/`PlayerCorner`/`styles.playScreen` 렌더링 블록은 원래 그대로 유지했다.

- [ ] **Step 6: 타입체크**

Run: `cd client && npm run build`
Expected: 에러 없이 통과 — Task 3에서 남겨뒀던 `App.tsx` 관련 에러가 이제 사라져야 한다.

- [ ] **Step 7: 서버+클라이언트 동시 실행**

Run(루트에서): `npm run dev`
Expected: 서버(2567)와 클라이언트(5173)가 둘 다 뜬다.

- [ ] **Step 8: 브라우저로 전체 흐름 확인**

브라우저 탭 여러 개(시크릿 창 포함)로 `http://localhost:5173` 접속:

1. 처음 접속한 탭에서 닉네임 입력 화면이 뜨는지, 입력하면 바로 방 목록 화면(빈 목록)으로 넘어가는지 확인.
2. 같은 탭을 새로고침해도 닉네임 화면이 다시 뜨지 않고 바로 방 목록으로 가는지 확인(localStorage 저장 확인).
3. "방 만들기"로 2v2 방 하나, 1v1 방 하나를 각각 만들어본다 — 제목을 입력하고 만들면 그 방의 대기실로 바로 들어가지는지, 대기실에 더 이상 "모드 선택" 섹션이 없는지 확인.
4. 다른 탭에서 방 목록을 보면(2초 안에) 방금 만든 두 방이 제목/모드/인원(`1/4`, `1/2`)과 함께 보이는지 확인.
5. 다른 탭에서 2v2 방에 "입장"으로 들어가서 나머지 인원(2v2는 총 4명, 1v1은 총 2명)을 채우고 팀/캐릭터/준비까지 마쳐 게임이 실제로 시작되는지 확인.
6. 게임이 시작된 방이 남은 열려있는 다른 탭의 방 목록에서 사라졌는지 확인(꽉 차서 자동 잠김).
7. 진행 중인 방에서 플레이어 탭 하나를 그냥 닫아본다(연결 끊김) — 잠시 후 다른 탭의 방 목록에 그 방이 다시 나타나지 않는지 확인(Task 2의 `this.lock()`이 실제로 동작하는지의 핵심 검증).
8. 게임을 끝까지 진행해 승리 화면이 뜨면 "로비로 돌아가기"를 눌러 방 목록 화면으로 정상적으로 돌아오는지 확인.
9. 1v1 방도 4번~5번과 동일하게 끝까지 확인(총 2명으로 시작되는지).

- [ ] **Step 9: 커밋**

```bash
git add client/src/App.tsx client/src/components/WaitingRoom.tsx client/src/components/WinnerScreen.tsx client/src/game/playerLabel.ts client/src/game/matchTypes.ts
git commit -m "닉네임/로비 화면을 App에 통합하고 대기실 모드 선택을 제거"
```

---

## Self-Review

**스펙 커버리지:**
- §1 화면 흐름 → Task 4(닉네임 게이트), Task 5(로비/방 만들기), Task 6(App.tsx 오케스트레이션 + WinnerScreen 복귀).
- §2 닉네임 → Task 1(정제 함수 + localStorage), Task 2(서버 저장), Task 6(playerLabel 우선순위).
- §3 방 목록/생성/입장 → Task 3(colyseus.ts), Task 5(RoomList/CreateRoomModal), Task 2(서버 메타데이터/maxClients).
- §4 서버 변경(스키마, onCreate/onJoin, `lock()`) → Task 2.
- §5 대기실 모드 선택 제거 → Task 2(서버 `pickMode` 삭제), Task 6(클라이언트 UI 삭제).
- §6 클라이언트 화면 구조 전체 → Task 3~6.
- §7 테스트 전략 → Task 1/2의 서버 TDD, Task 6의 브라우저 체크리스트.
- §8 범위 제외(로그인/친구/관전/재접속) → 이 플랜의 어떤 태스크도 건드리지 않음, 확인 완료.

**플레이스홀더 스캔**: 없음 — 모든 스텝에 실제 코드/실행 명령/정확한 before-after 텍스트가 포함됨.

**타입 일관성**: 서버 `PlayerState.nickname`(Task 2)과 클라이언트 `matchTypes.ts`의 `PlayerState.nickname`(Task 6)이 이름·타입 일치. `createRoom(title, mode, nickname)`/`joinRoom(roomId, nickname)`(Task 3 정의)이 `CreateRoomModal`/`RoomList`(Task 5)의 호출부와 인자 순서·타입 일치. `RoomList`의 `onRoomJoined`/`WinnerScreen`의 `onLeaveLobby` 콜백 시그니처가 `App.tsx`(Task 6)의 `setRoom`/`() => setRoom(null)` 전달과 일치.
