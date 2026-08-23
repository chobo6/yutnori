# 방 만들기/입장 로비

> `docs/REQUIREMENTS.md` §3("songpyeon과 동일한 방식: 로비에서 방을 만들거나 기존 방에 참가")를 실제로 구현한다. 지금은 `client.joinOrCreate("match")` 하나로 아무나 열린 방에 자동 매칭되는 상태 — 이 스펙은 방 목록/방 만들기 화면과 그에 맞는 서버 변경을 다룬다. 구글 로그인은 이번 범위 밖(§8) — 대신 임시 닉네임을 붙인다.

## 0. songpyeon과의 차이 — 왜 그대로 베끼지 않는가

songpyeon은 구글 로그인 + 닉네임 + 친구 초대까지 있는 완전한 로비 시스템이지만, yutnori의 `REQUIREMENTS.md` §3는 "방을 만들거나 기존 방에 참가"만 요구한다. 이번 스펙은 **기능적으로 동일한 결과**(방 목록에서 고르거나 새로 만들어 입장)를 훨씬 적은 코드로 낸다:

- songpyeon은 서버에 `/api/rooms` REST 엔드포인트를 직접 만들어 `matchMaker.query()`로 방 목록을 내려준다. yutnori는 Colyseus 클라이언트가 이미 제공하는 `client.getAvailableRooms(roomName)`을 그대로 쓴다 — 별도 REST 라우트가 필요 없다.
- songpyeon은 로그인 사용자라 닉네임이 계정에 귀속된다. yutnori는 로그인이 없으므로 **닉네임은 순수 클라이언트 값**(localStorage)이고, 서버는 그 값을 그대로 신뢰해 표시에만 쓴다(권한/식별에는 안 씀 — 식별은 지금처럼 Colyseus `sessionId` 그대로).
- 친구 초대, 관전 모드는 이번 범위에서 제외(§8).

## 1. 화면 흐름

```
사이트 접속
  └─ localStorage에 닉네임 없음 → 닉네임 입력 화면(1회)
       └─ 입력 완료 → 로비(방 목록)
  └─ localStorage에 닉네임 있음 → 바로 로비(방 목록)

로비(방 목록, 2초마다 갱신)
  ├─ "방 만들기" → 제목 입력 + 모드(2v2/1v1) 선택 → 방 생성, 그 방으로 바로 입장
  └─ 목록에서 "입장" → 그 방으로 입장

대기실(팀 선택 + 캐릭터 선택 + 준비) — 기존 그대로, 모드 선택 섹션만 제거
  └─ 인원 다 차고 전원 준비 → 게임 시작(기존 그대로)

게임 종료(WinnerScreen) → "로비로 돌아가기" → 방 목록으로
```

닉네임은 대기실/게임 화면에서 지금 쓰는 `playerLabel()`(예: `"A팀 나"`)을 대체하는 게 아니라 **우선순위를 바꾼다** — 닉네임이 있으면 닉네임을, 없으면(이론상 없을 일이 없지만 방어적으로) 기존 표시로 폴백.

## 2. 닉네임

- `client/src/game/nickname.ts`(신규): `getStoredNickname(): string | null` / `setStoredNickname(v: string): void` — `localStorage` 키 하나(`yutnori:nickname`)로 저장.
- 닉네임 입력 화면(신규 컴포넌트, 예: `NicknameGate.tsx`)은 `getStoredNickname()`이 `null`일 때만 `App.tsx`가 렌더링 — 입력 후 `setStoredNickname()` 호출하고 로비로 넘어감. 이후 세션에서는 이 화면을 다시 안 봄.
- 방 생성(`client.create`)과 방 입장(`client.joinById`) 양쪽 모두 두 번째 인자로 `{ nickname }`을 넘긴다 — Colyseus는 이 옵션을 서버의 `onJoin(client, options)`에 그대로 전달한다.
- 서버: `PlayerState`에 `nickname` 필드 추가(§4). `onJoin`이 `options.nickname`을 정제해서 저장.
- 닉네임 정제는 `server/src/game/nickname.ts`(신규, songpyeon의 `roomTitle.ts` 패턴을 그대로 따름):

```ts
const MAX_NICKNAME_LENGTH = 12;

export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, MAX_NICKNAME_LENGTH);
}
```

  빈 문자열이 되면 `onJoin`이 `"플레이어"` 같은 고정 폴백을 채운다(호출부가 문맥에 맞는 기본값을 정하도록, `roomTitle.ts`의 주석과 같은 이유).

## 3. 방 목록 · 방 생성 · 입장

**목록 조회** — REST 없이 Colyseus 클라이언트 내장 기능:

```ts
// client/src/colyseus.ts
export async function listRooms() {
  return client.getAvailableRooms<{ title: string; mode: "2v2" | "1v1" }>("match");
}
```

반환값(`RoomAvailable[]`)에는 `roomId`, `clients`(현재 인원), `maxClients`, 그리고 서버가 `setMetadata()`로 넣어준 `metadata`(여기선 `title`/`mode`)가 들어있다. 로비 화면은 이 배열을 2초 간격 `setInterval`로 다시 불러 다시 그린다(송편과 같은 주기).

**방 생성:**

```ts
export function createRoom(title: string, mode: "2v2" | "1v1", nickname: string) {
  return client.create<MatchState>("match", { title, mode, nickname });
}
```

**방 입장:**

```ts
export function joinRoom(roomId: string, nickname: string) {
  return client.joinById<MatchState>(roomId, { nickname });
}
```

기존 `joinMatch()`(`client.joinOrCreate`)는 삭제 — 더 이상 "아무 방이나" 자동 매칭하지 않는다.

## 4. 서버 변경

**`server/src/rooms/MatchState.ts`** — `PlayerState`에 필드 추가:

```ts
export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = ""; // 신규
  @type("string") team: string = "";
  @type("boolean") ready: boolean = false;
  @type(["string"]) characters = new ArraySchema<string>();
}
```

**`server/src/rooms/MatchRoom.ts`** — `onCreate`/`onJoin` 변경:

```ts
onCreate(options?: {
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
  this.setMetadata({ title, mode });

  if (typeof options?.throwTimeoutMs === "number") this.throwTimeoutMs = options.throwTimeoutMs;
  if (typeof options?.moveTimeoutMs === "number") this.moveTimeoutMs = options.moveTimeoutMs;
  if (typeof options?.rng === "function") this.rng = options.rng;

  // 기존 onMessage 등록부는 그대로 — 단, "pickMode" 핸들러는 삭제(§5).
  ...
}

onJoin(client: Client, options?: { nickname?: string }) {
  const player = new PlayerState();
  player.sessionId = client.sessionId;
  player.nickname = sanitizeNickname(options?.nickname) || "플레이어";
  this.state.players.set(client.sessionId, player);
}
```

`maxClients`는 지금처럼 필드 기본값(`= 4`)이 아니라 `onCreate`에서 `mode`를 보고 정해야 한다 — 필드 선언의 `= 4`는 지운다.

**필수 버그 예방 — `maybeStartGame()`에 `this.lock()` 추가:**

Colyseus는 `maxClients`에 도달하면 자동으로 방을 잠그지만(그래서 꽉 찬 방은 `getAvailableRooms` 목록에 자연히 안 뜬다), **누군가 나가는 순간 그 자동 잠금이 자동으로 풀린다**(`_lockedExplicitly`가 아니라서). 게임이 이미 `"playing"` 단계로 들어간 뒤에 한 명이 연결을 끊으면(재접속 로직이 없는 이 프로젝트에서는 실제로 일어나는 상황), 그 즉시 방이 다시 목록에 나타나 낯선 플레이어가 진행 중인 매치에 들어올 수 있다. `maybeStartGame()`이 `this.state.phase = "playing"`으로 바꾸는 지점에 `this.lock()`을 명시적으로 호출해 이를 막는다(송편의 `MatchRoom.ts`에 있는 것과 같은 패턴, `docs/TROUBLESHOOTING.md`급 실수를 미리 막는 것):

```ts
this.state.phase = "playing";
this.lock(); // 신규 — maxClients 자동 잠금은 플레이어 이탈 시 풀리므로 명시적으로 잠가야 한다
this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
```

## 5. 대기실 변경 — 모드 선택 제거

`client/src/components/WaitingRoom.tsx`에서 "모드 선택" `<section>`(2v2/1v1 버튼)과 `pickMode()` 함수를 삭제 — 모드는 이제 방 생성 시 고정되고 대기실 진입 시점엔 이미 `room.state.mode`가 정해져 있다. 나머지(팀 선택/캐릭터 선택/준비)는 그대로.

서버 쪽 `onMessage("pickMode", ...)` 핸들러도 삭제(§4의 `onCreate`에서 언급).

## 6. 클라이언트 화면 구조

**신규 파일:**
- `client/src/game/nickname.ts` — §2.
- `server/src/game/nickname.ts` — §2.
- `client/src/components/NicknameGate.tsx` + `.module.css` — 닉네임 입력 폼 하나. 제출 시 `setStoredNickname()` 호출.
- `client/src/components/RoomList.tsx` + `.module.css` — 로비 화면. `listRooms()`를 2초 간격으로 폴링해 방 목록(제목/모드/인원 `x/y`)을 렌더링, 각 행에 "입장" 버튼, 상단에 "방 만들기" 버튼.
- `client/src/components/CreateRoomModal.tsx` + `.module.css` — 제목 입력(텍스트) + 모드 선택(2v2/1v1) + "만들기" 버튼. 제출 시 `createRoom()` 호출.

**수정 파일:**
- `client/src/colyseus.ts` — `joinMatch()` 삭제, `listRooms()`/`createRoom()`/`joinRoom()` 추가(§3).
- `client/src/game/useMatchRoom.ts` — 지금은 마운트 시 자동으로 `joinMatch()`를 호출해 방을 얻는 훅이지만, 이제 "방을 얻는 것"과 "얻은 방의 상태를 구독하는 것"을 분리해야 한다. 시그니처를 `useMatchRoom(room: Room<MatchState> | null)`로 바꿔 **이미 연결된 `Room`을 받아 `onStateChange`/`forceRender` 구독만 하는 훅**으로 축소한다(기존 `room.onStateChange`+`forceRender()` 패턴은 그대로 유지 — `CLAUDE.md`가 경고하는 대로 `.once()`로 되돌리지 말 것). `room`이 `null`이면 아무 구독도 안 하고 `{room: null, status: "idle"}` 비슷한 값을 반환.
- `client/src/App.tsx` — 최상위에 `const [room, setRoom] = useState<Room<MatchState> | null>(null)` 추가. 렌더 분기:
  1. `getStoredNickname()`이 없으면 `<NicknameGate onDone={...} />`.
  2. 닉네임은 있는데 `room`이 없으면 `<RoomList onRoomJoined={setRoom} nickname={...} />`(방 만들기 모달도 이 화면이 소유).
  3. `room`이 있으면 지금처럼 `useMatchRoom(room)`으로 상태 구독하고 phase별로 `WaitingRoom`/`GameBoard`/`WinnerScreen` 렌더링(기존 로직 그대로).
- `client/src/components/WinnerScreen.tsx` — "로비로 돌아가기" 버튼 추가. 클릭 시 `room.leave()` 호출 후 `App.tsx`가 넘겨준 콜백으로 `setRoom(null)`(로비로 복귀).
- `client/src/game/playerLabel.ts` — `player.nickname`이 있으면 그것을 우선 반환하도록 수정(없으면 기존 방식 그대로 폴백 — 이론상 항상 있지만 방어적으로 유지).
- `client/src/game/matchTypes.ts` — `PlayerState`에 `nickname: string` 필드 추가(서버 스키마와 손으로 맞추는 기존 관례).

## 7. 테스트 전략

- 서버(`server/src/game/nickname.ts`)는 순수 함수라 TDD로: 빈 문자열/공백/최대 길이 초과 케이스.
- `server/src/rooms/MatchRoom.test.ts`(기존 파일에 케이스 추가): `onCreate` 옵션에 따라 `maxClients`/`state.mode`/메타데이터가 올바르게 설정되는지, `onJoin` 옵션의 닉네임이 정제되어 `PlayerState.nickname`에 들어가는지, `maybeStartGame()`이 `"playing"` 전환 시 실제로 방을 잠그는지(`this.locked` 확인).
- 클라이언트는 기존 관례대로 `npm run build` + 브라우저 확인: 닉네임 입력 → 로비 → 방 만들기(2v2, 1v1 각각) → 다른 탭에서 목록에 뜨는지 → 입장 → 대기실 → 게임 시작까지 실제로 두 개 이상의 브라우저 탭으로 끝까지 확인. 특히 방이 꽉 찬 뒤 목록에서 사라지는지, 게임 시작 후 한 명이 탭을 닫아도 그 방이 목록에 다시 뜨지 않는지(§4의 `lock()` 확인) 실제로 확인.

## 8. 이번 범위에서 제외하는 것

- 구글 로그인/계정 시스템 — 사용자가 이번 세션에서 "나중에" 확정. 닉네임은 순수 클라이언트 값으로 남는다.
- 친구 초대, 관전 모드, 방 비밀번호/잠금, 방 목록 필터/정렬 — songpyeon에는 있지만 `REQUIREMENTS.md` §3가 요구하지 않음.
- 재접속(reconnect) — 이 프로젝트는 이미 "재접속 로직 없음"이 확정된 설계(턴 타임아웃으로 대체, `CLAUDE.md` 참고). 로비 기능 추가가 이 결정을 바꾸지 않는다.
