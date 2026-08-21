# 대기실 + 기본 플레이 화면 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 클라이언트에서 4명이 실제로 대기실(팀/캐릭터 선택)을 거쳐 플레이 화면(보드 표시, 던지기, 말 이동)까지 종단간으로 플레이할 수 있게 만든다. 게이지 시각 연출(Matter.js)과 채팅은 이번 계획 범위 밖 — 던지기는 "누르고 있다가 떼기" 버튼 하나로 실제 게이지 판정 메시지(`throwStart`/`throwRelease`)를 그대로 보내되, 화면에 움직이는 게이지 바는 그리지 않는다(후속 계획에서 연출 추가).

**Architecture:** 서버가 이미 완성된 `MatchRoom`/`MatchState`(Colyseus)를 그대로 사용한다. 클라이언트는 `client/src/game/`(순수 타입/훅)과 `client/src/components/`(화면)로 나뉘며, songpyeon 프로젝트의 확립된 패턴(모듈 스코프 `joinMatch()` 캐싱, 첫 `onStateChange` 대기 후 connected 전환, 이후 상태 변경마다 `forceRender`)을 그대로 재사용한다. 클라이언트에는 자동화 테스트 프레임워크가 없다(songpyeon과 동일한 이 프로젝트의 확립된 관례) — 각 태스크는 타입체크/빌드로 검증하고, 마지막 태스크에서 Playwright로 실제 4개 탭을 띄워 종단간 검증한다.

**Tech Stack:** React 19 + TypeScript + Vite, colyseus.js. CSS Modules(songpyeon과 동일 관례). 이번 계획에서는 Matter.js를 쓰지 않는다(후속 계획에서 던지기 연출에만 사용 예정 — ARCHITECTURE.md §1).

**Spec:** `yutnori/docs/REQUIREMENTS.md` (v0.3), `yutnori/docs/ARCHITECTURE.md` (v0.1)

## Global Constraints

- 서버 권위형: 클라이언트는 `room.state`를 그리기만 하고 판정을 복제하지 않는다. 말 이동/잡기/업기/승리 판정은 전부 서버가 이미 계산해 `room.state`로 내려준다.
- 던지기는 실제 `throwStart`/`throwRelease` 메시지를 그대로 사용한다(REQUIREMENTS.md §5) — "누르기 시작 = throwStart, 떼기 = throwRelease"를 그대로 매핑, 결과를 미리 계산하거나 흉내내지 않는다.
- 턴을 잡은 플레이어는 자기 말 2개만 이동 대상으로 선택 가능 (REQUIREMENTS.md §4) — UI에서도 다른 사람 말은 선택 불가능하게 목록에서 제외한다.
- 캐릭터는 4종(교주/성직/마담/의사) 중 정확히 2종 선택, 중복 선택 가능 (REQUIREMENTS.md §2).
- 팀 배정은 수동(A/B 버튼) (REQUIREMENTS.md §3).
- 클라이언트에는 테스트 프레임워크가 없다 — 대신 매 태스크마다 `npm run build`(타입체크)로 검증하고, 마지막 태스크에서 실제 브라우저로 종단간 검증한다(이 프로젝트의 확립된 관례, songpyeon과 동일).
- 채팅/말풍선(REQUIREMENTS.md §8)과 게이지 시각 연출/Matter.js(REQUIREMENTS.md §10)는 이번 계획 범위 밖.

---

### Task 1: 클라이언트 타입 정의 (`matchTypes.ts`)

**Files:**
- Create: `client/src/game/matchTypes.ts`

**Interfaces:**
- Produces:
  - `type PositionKind = "start" | "outer" | "center" | "finished"`
  - `interface PlayerState { sessionId: string; team: "A" | "B" | ""; ready: boolean; characters: string[] }`
  - `interface PieceState { id: string; ownerSessionId: string; positionKind: PositionKind; positionIndex: number; previousPositionKind: PositionKind; previousPositionIndex: number }`
  - `interface MatchState { phase: "waiting" | "playing" | "finished"; players: Map<string, PlayerState>; pieces: PieceState[]; turnOrder: string[]; currentTurnIndex: number; gaugePhase: "idle" | "charging" | "resolved"; throwStartAt: number; lastThrowResult: string; turnDeadlineAt: number; winnerSessionId: string }`
  - `const CHARACTERS: readonly ["교주", "성직", "마담", "의사"]`
  - `const YUT_RESULT_LABELS: Record<string, string>` (서버가 보내는 영문 결과 코드 → 한글 표시)

이 타입들은 서버의 `server/src/rooms/MatchState.ts`(Colyseus Schema)와 `server/src/game/gauge.ts`(`YutResult`)를 손으로 그대로 옮긴 것이다 — client/server가 별도 워크스페이스라 공유 타입 패키지가 없으므로(songpyeon과 동일한 관례), 서버 필드가 바뀌면 이 파일도 수동으로 맞춰야 한다. `players`/`pieces`는 실제로는 Colyseus의 `MapSchema`/`ArraySchema`(각각 `Map`과 배열처럼 동작)이므로, 컴포넌트에서 쓸 때는 `room.state.players.get(id)`, `Array.from(room.state.players.entries())`, `room.state.pieces.find(...)`처럼 실제 Map/배열 메서드를 그대로 쓰면 된다.

- [ ] **Step 1: 파일 작성**

```typescript
// client/src/game/matchTypes.ts

export type PositionKind = "start" | "outer" | "center" | "finished";

export interface PlayerState {
  sessionId: string;
  team: "A" | "B" | "";
  ready: boolean;
  characters: string[];
}

export interface PieceState {
  id: string;
  ownerSessionId: string;
  positionKind: PositionKind;
  positionIndex: number;
  previousPositionKind: PositionKind;
  previousPositionIndex: number;
}

export interface MatchState {
  phase: "waiting" | "playing" | "finished";
  players: Map<string, PlayerState>;
  pieces: PieceState[];
  turnOrder: string[];
  currentTurnIndex: number;
  gaugePhase: "idle" | "charging" | "resolved";
  throwStartAt: number;
  lastThrowResult: string;
  turnDeadlineAt: number;
  winnerSessionId: string;
}

export const CHARACTERS = ["교주", "성직", "마담", "의사"] as const;
export type CharacterId = (typeof CHARACTERS)[number];

// server/src/game/gauge.ts의 YutResult와 동일한 6개 코드.
export const YUT_RESULT_LABELS: Record<string, string> = {
  backDo: "빽도",
  do: "도",
  gae: "개",
  geol: "걸",
  yut: "윷",
  mo: "모",
};

// server/src/game/position.ts의 SHORTCUT_JUNCTIONS(5, 10, 15)와 동일.
export const SHORTCUT_JUNCTION_INDICES = new Set([5, 10, 15]);
```

- [ ] **Step 2: 타입체크로 확인**

Run (client 워크스페이스 루트에서): `npm run build`
Expected: 에러 없음 (이 파일만 추가했으므로 기존 빌드가 그대로 통과해야 한다)

- [ ] **Step 3: Commit**

```bash
git add client/src/game/matchTypes.ts
git commit -m "클라이언트 MatchState 타입 정의 (서버 스키마 수동 미러링)"
```

---

### Task 2: Colyseus 연결 훅 재작성 (`colyseus.ts`, `useMatchRoom.ts`)

**Files:**
- Modify: `client/src/colyseus.ts`
- Delete: `client/src/useMatchRoom.ts` (Task 1의 `client/src/game/useMatchRoom.ts`로 이동)
- Create: `client/src/game/useMatchRoom.ts`
- Modify: `client/src/App.tsx` (import 경로 및 placeholder 화면 갱신 — Task 6에서 최종 라우팅으로 다시 갱신되므로 여기서는 연결 상태만 확인하는 임시 화면 유지)

**Interfaces:**
- Consumes: `MatchState` (Task 1의 `matchTypes.ts`)
- Produces:
  - `function joinMatch(): Promise<Room<MatchState>>` (`colyseus.ts`)
  - `function useMatchRoom(): { room: Room<MatchState> | null; status: "connecting" | "connected" | "error" }` (`game/useMatchRoom.ts`)

**기존 placeholder의 실제 버그:** 현재 `useMatchRoom.ts`는 `onStateChange.once(...)`를 써서 **최초 1회**만 리렌더를 트리거한다 — 이후 서버에서 상태가 바뀌어도(턴이 넘어가거나 말이 움직여도) 화면이 갱신되지 않는다. 이번 태스크에서 songpyeon의 패턴(`useReducer` 기반 `forceRender`, 매 `onStateChange`마다 호출)으로 교체해 고친다.

- [ ] **Step 1: `colyseus.ts`를 타입이 붙은 버전으로 교체**

```typescript
// client/src/colyseus.ts
import { Client, type Room } from "colyseus.js";
import type { MatchState } from "./game/matchTypes";

const client = new Client(
  import.meta.env.VITE_COLYSEUS_URL ?? "ws://localhost:2567",
);

// React StrictMode의 effect 이중 실행 때문에 joinOrCreate가 두 번 호출되는 것을 막기 위해
// 모듈 스코프에 join promise를 캐싱한다 (songpyeon과 동일한 패턴).
let joinPromise: Promise<Room<MatchState>> | null = null;

export function joinMatch(): Promise<Room<MatchState>> {
  if (!joinPromise) {
    joinPromise = client.joinOrCreate<MatchState>("match");
  }
  return joinPromise;
}
```

- [ ] **Step 2: 기존 `client/src/useMatchRoom.ts` 삭제하고 `client/src/game/useMatchRoom.ts`로 새로 작성**

```typescript
// client/src/game/useMatchRoom.ts
import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom() {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    let hasReceivedState = false;

    joinMatch()
      .then((joined) => {
        if (disposed) return;
        // joinOrCreate가 resolve돼도 room.state는 아직 비어있을 수 있어
        // 첫 onStateChange를 받은 뒤에야 connected로 전환한다.
        joined.onStateChange(() => {
          if (!hasReceivedState) {
            hasReceivedState = true;
            setRoom(joined);
            setStatus("connected");
          } else {
            // 이후의 모든 상태 변경(턴 전환, 말 이동 등)마다 리렌더를 강제한다 —
            // room 객체 참조 자체는 안 바뀌므로 setRoom만으로는 리렌더되지 않는다.
            forceRender();
          }
        });
      })
      .catch((err) => {
        console.error("방 연결 실패", err);
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { room, status };
}
```

- [ ] **Step 3: `App.tsx`의 import 경로를 갱신 (화면 자체는 Task 6에서 다시 교체)**

```typescript
// client/src/App.tsx
import { useMatchRoom } from "./game/useMatchRoom";
import "./App.css";

function App() {
  const { status, room } = useMatchRoom();

  return (
    <div>
      <h1>윷놀이</h1>
      <p>연결 상태: {status}</p>
      {room && <p>room id: {room.roomId}</p>}
    </div>
  );
}

export default App;
```

- [ ] **Step 4: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add client/src/colyseus.ts client/src/App.tsx
git rm client/src/useMatchRoom.ts
git add client/src/game/useMatchRoom.ts
git commit -m "Colyseus 연결 훅을 game/ 아래로 이동하고 타입 적용, 상태 갱신 누락 버그 수정"
```

---

### Task 3: 플레이어 표시 헬퍼 (`playerLabel.ts`)

**Files:**
- Create: `client/src/game/playerLabel.ts`

**Interfaces:**
- Consumes: `MatchState`, `PlayerState` (Task 1)
- Produces: `function playerLabel(sessionId: string, room: Room<MatchState>): string`

이 함수는 Task 4(대기실)와 Task 5/6(플레이 화면/승리 화면) 전부에서 "이 세션ID가 누구인지" 화면에 표시할 때 공통으로 쓴다. 이 프로젝트에는 아직 닉네임 시스템이 없으므로(REQUIREMENTS.md에 명시 없음), 팀 + "나" 여부 + 세션ID 앞 4자리로 표시한다.

- [ ] **Step 1: 파일 작성**

```typescript
// client/src/game/playerLabel.ts
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 닉네임 시스템이 없으므로 팀 + 본인 여부 + 세션ID 일부로 표시한다. */
export function playerLabel(sessionId: string, room: Room<MatchState>): string {
  const player = room.state.players.get(sessionId);
  const teamLabel = player?.team ? `${player.team}팀 ` : "";
  const isMe = sessionId === room.sessionId;
  return `${teamLabel}${isMe ? "나" : sessionId.slice(0, 4)}`;
}
```

- [ ] **Step 2: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 3: Commit**

```bash
git add client/src/game/playerLabel.ts
git commit -m "플레이어 표시 헬퍼(playerLabel) 추가"
```

---

### Task 4: 대기실 화면 (`WaitingRoom.tsx`)

**Files:**
- Create: `client/src/components/WaitingRoom.tsx`
- Create: `client/src/components/WaitingRoom.module.css`

**Interfaces:**
- Consumes: `MatchState`, `CHARACTERS`, `CharacterId` (Task 1), `playerLabel` (Task 3)
- Produces: `function WaitingRoom(props: { room: Room<MatchState> }): JSX.Element`

**동작:**
- 방에 들어온 플레이어 전원(최대 4명)을 목록으로 보여준다 — 각자의 팀/캐릭터 선택 현황/준비 여부.
- "A팀"/"B팀" 버튼 — 클릭 시 `room.send("pickTeam", { team: "A" | "B" })`.
- 캐릭터 4종 토글 버튼 — 로컬에서 선택 상태를 들고 있다가, 정확히 2개가 선택된 순간 자동으로 `room.send("pickCharacters", { characters: [...] })`를 보낸다(REQUIREMENTS.md §2 — 별도의 "확정" 버튼 없이 2개 선택 즉시 확정하는 것으로 단순화, 세 번째를 누르면 가장 먼저 선택했던 것을 밀어낸다).
- "준비" 버튼 — 클릭마다 `room.send("ready", {})`(서버에서 토글).
- 본인의 현재 선택 상태(팀/캐릭터/준비여부)는 `room.state.players.get(room.sessionId)`에서 읽어 버튼에 반영한다(예: 선택된 팀 버튼 강조).

- [ ] **Step 1: 파일 작성**

```typescript
// client/src/components/WaitingRoom.tsx
import { useState } from "react";
import type { Room } from "colyseus.js";
import { CHARACTERS, type CharacterId, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./WaitingRoom.module.css";

export function WaitingRoom({ room }: { room: Room<MatchState> }) {
  const me = room.state.players.get(room.sessionId);
  const [pendingCharacters, setPendingCharacters] = useState<CharacterId[]>(
    (me?.characters ?? []) as CharacterId[],
  );

  function pickTeam(team: "A" | "B") {
    room.send("pickTeam", { team });
  }

  function toggleCharacter(character: CharacterId) {
    setPendingCharacters((prev) => {
      let next: CharacterId[];
      if (prev.includes(character)) {
        next = prev.filter((c) => c !== character);
      } else if (prev.length >= 2) {
        next = [prev[1], character]; // 가장 오래된 선택을 밀어내고 새로 추가
      } else {
        next = [...prev, character];
      }
      if (next.length === 2) {
        room.send("pickCharacters", { characters: next });
      }
      return next;
    });
  }

  function toggleReady() {
    room.send("ready", {});
  }

  const players = Array.from(room.state.players.values());

  return (
    <div className={styles.wrap}>
      <h2>대기실</h2>

      <section>
        <h3>팀 선택</h3>
        <button
          type="button"
          className={me?.team === "A" ? styles.selected : undefined}
          onClick={() => pickTeam("A")}
        >
          A팀
        </button>
        <button
          type="button"
          className={me?.team === "B" ? styles.selected : undefined}
          onClick={() => pickTeam("B")}
        >
          B팀
        </button>
      </section>

      <section>
        <h3>캐릭터 선택 (2종)</h3>
        {CHARACTERS.map((character) => (
          <button
            key={character}
            type="button"
            className={pendingCharacters.includes(character) ? styles.selected : undefined}
            onClick={() => toggleCharacter(character)}
          >
            {character}
          </button>
        ))}
      </section>

      <section>
        <button type="button" onClick={toggleReady}>
          {me?.ready ? "준비 취소" : "준비 완료"}
        </button>
      </section>

      <section>
        <h3>참가자 ({players.length}/4)</h3>
        <ul>
          {players.map((player) => (
            <li key={player.sessionId}>
              {playerLabel(player.sessionId, room)} — 팀: {player.team || "미정"}, 캐릭터:{" "}
              {player.characters.length > 0 ? player.characters.join(", ") : "미정"}, 준비:{" "}
              {player.ready ? "완료" : "대기중"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: 최소 스타일 작성 (선택 상태만 시각적으로 구분 — 폴리시는 후속 계획)**

```css
/* client/src/components/WaitingRoom.module.css */
.wrap {
  padding: 1rem;
}

.selected {
  outline: 2px solid #2f6feb;
  font-weight: bold;
}
```

- [ ] **Step 3: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add client/src/components/WaitingRoom.tsx client/src/components/WaitingRoom.module.css
git commit -m "대기실 화면(팀/캐릭터 선택, 준비) 구현"
```

---

### Task 5: 보드 화면 (`GameBoard.tsx`)

**Files:**
- Create: `client/src/components/GameBoard.tsx`
- Create: `client/src/components/GameBoard.module.css`

**Interfaces:**
- Consumes: `MatchState`, `PieceState`, `SHORTCUT_JUNCTION_INDICES` (Task 1), `playerLabel` (Task 3)
- Produces: `function GameBoard(props: { room: Room<MatchState> }): JSX.Element`

**동작 (기능 우선 — 정사각형 보드 그림이나 호랑이 문양 등 시각 폴리시는 후속 계획):**
- 외곽 1~19번 칸을 순서대로 나열하고, 지름길 분기점(5/10/15번)은 라벨에 "★" 표시.
- 중앙 칸을 별도로 표시.
- 각 플레이어별로 "대기"(출발 전, `positionKind==="start"`) 트레이와 "완주"(`positionKind==="finished"`) 트레이를 표시.
- 각 칸/트레이 안에는 그 위치에 있는 말들을 작은 토큰(소속 팀 색 + 소유자 라벨)으로 렌더링한다 — 업힌 말은 같은 칸에 여러 개가 자연스럽게 나란히 표시된다(별도 로직 불필요, `pieces.filter(위치 일치)`만으로 충분).

- [ ] **Step 1: 파일 작성**

```typescript
// client/src/components/GameBoard.tsx
import type { Room } from "colyseus.js";
import { SHORTCUT_JUNCTION_INDICES, type MatchState, type PieceState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./GameBoard.module.css";

const OUTER_INDICES = Array.from({ length: 19 }, (_, i) => i + 1);

function PieceToken({ piece, room }: { piece: PieceState; room: Room<MatchState> }) {
  const owner = room.state.players.get(piece.ownerSessionId);
  const teamClass = owner?.team === "A" ? styles.teamA : owner?.team === "B" ? styles.teamB : undefined;
  return (
    <span className={`${styles.token} ${teamClass ?? ""}`} title={playerLabel(piece.ownerSessionId, room)}>
      {playerLabel(piece.ownerSessionId, room).slice(0, 2)}
    </span>
  );
}

export function GameBoard({ room }: { room: Room<MatchState> }) {
  const pieces = Array.from(room.state.pieces);
  const players = Array.from(room.state.players.values());

  const piecesAtOuter = (index: number) => pieces.filter((p) => p.positionKind === "outer" && p.positionIndex === index);
  const piecesAtCenter = pieces.filter((p) => p.positionKind === "center");
  const piecesInTray = (sessionId: string, kind: "start" | "finished") =>
    pieces.filter((p) => p.ownerSessionId === sessionId && p.positionKind === kind);

  return (
    <div className={styles.wrap}>
      <h3>보드</h3>
      <div className={styles.outerRow}>
        {OUTER_INDICES.map((index) => (
          <div key={index} className={styles.cell}>
            <span className={styles.cellLabel}>
              {index}
              {SHORTCUT_JUNCTION_INDICES.has(index) ? "★" : ""}
            </span>
            {piecesAtOuter(index).map((p) => (
              <PieceToken key={p.id} piece={p} room={room} />
            ))}
          </div>
        ))}
      </div>

      <div className={styles.centerCell}>
        <span className={styles.cellLabel}>중앙</span>
        {piecesAtCenter.map((p) => (
          <PieceToken key={p.id} piece={p} room={room} />
        ))}
      </div>

      <div className={styles.trays}>
        {players.map((player) => (
          <div key={player.sessionId} className={styles.tray}>
            <strong>{playerLabel(player.sessionId, room)}</strong>
            <div>
              대기:{" "}
              {piecesInTray(player.sessionId, "start").map((p) => (
                <PieceToken key={p.id} piece={p} room={room} />
              ))}
            </div>
            <div>
              완주:{" "}
              {piecesInTray(player.sessionId, "finished").map((p) => (
                <PieceToken key={p.id} piece={p} room={room} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 최소 스타일 작성**

```css
/* client/src/components/GameBoard.module.css */
.wrap {
  padding: 1rem;
}

.outerRow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.cell,
.centerCell {
  border: 1px solid #999;
  min-width: 2.5rem;
  min-height: 2.5rem;
  padding: 0.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.cellLabel {
  font-size: 0.75rem;
  color: #555;
}

.token {
  display: inline-block;
  border-radius: 999px;
  padding: 0.1rem 0.35rem;
  margin: 0.1rem;
  font-size: 0.7rem;
  color: white;
  background: #666;
}

.teamA {
  background: #2f6feb;
}

.teamB {
  background: #d9534f;
}

.trays {
  display: flex;
  gap: 1rem;
  margin-top: 1rem;
}

.tray {
  border: 1px solid #ccc;
  padding: 0.5rem;
}
```

- [ ] **Step 3: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 4: Commit**

```bash
git add client/src/components/GameBoard.tsx client/src/components/GameBoard.module.css
git commit -m "보드 화면(외곽/중앙/대기·완주 트레이, 말 토큰) 구현"
```

---

### Task 6: 턴 진행 화면 + 승리 화면 (`TurnPanel.tsx`, `WinnerScreen.tsx`) + `App.tsx` 라우팅

**Files:**
- Create: `client/src/components/TurnPanel.tsx`
- Create: `client/src/components/WinnerScreen.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `MatchState`, `PieceState`, `YUT_RESULT_LABELS`, `SHORTCUT_JUNCTION_INDICES` (Task 1), `playerLabel` (Task 3), `WaitingRoom` (Task 4), `GameBoard` (Task 5)
- Produces: `function TurnPanel(props: { room: Room<MatchState> }): JSX.Element`, `function WinnerScreen(props: { room: Room<MatchState> }): JSX.Element`

**TurnPanel 동작:**
- 현재 턴 플레이어를 표시(`playerLabel`), 내 턴이면 강조 문구.
- 남은 제한시간(초)을 `room.state.turnDeadlineAt - Date.now()`로 계산해 1초 간격으로 갱신해 보여준다(서버-클라이언트 시계 오차 보정은 이번 계획 범위 밖 — songpyeon의 `clockSync.ts` 패턴은 후속 계획에서 필요하면 도입).
- 내 턴이고 `gaugePhase === "idle"`이면: **"누르고 있다가 떼기"** 버튼 하나를 보여준다 — `onPointerDown`에서 `room.send("throwStart", {})`, `onPointerUp`에서 `room.send("throwRelease", {})`를 보낸다. 이것이 REQUIREMENTS.md §5의 실제 게이지 던지기 메커니즘이다 — 애니메이션 바만 없을 뿐, 누르고 뗀 시간 간격이 그대로 서버 판정에 쓰인다.
- 내 턴이고 `gaugePhase === "charging"`이면: "누르고 있는 중..." 안내만 표시(버튼은 이미 눌린 상태이므로 추가 조작 없음).
- 내 턴이고 `gaugePhase === "resolved"`이면: `YUT_RESULT_LABELS[room.state.lastThrowResult]`로 결과를 보여주고, 완주하지 않은 내 말 목록을 버튼으로 나열한다. 각 버튼 옆에, 그 말이 지름길 분기점(`SHORTCUT_JUNCTION_INDICES`에 포함된 outer 칸 또는 center)에 있으면 "지름길 사용" 체크박스를 같이 보여준다. 말 버튼을 누르면 `room.send("movePiece", { pieceId, useShortcut })`을 보낸다.
- 내 턴이 아니면: 위 세 상태와 무관하게 "OO님의 턴을 기다리는 중"만 표시.

**WinnerScreen 동작:**
- `room.state.winnerSessionId`와 그 사람의 팀을 `playerLabel`로 보여준다.

**App.tsx 라우팅:**
- `status !== "connected"`: 연결 상태만 표시(기존 placeholder 그대로 유지).
- `room.state.phase === "waiting"`: `<WaitingRoom room={room} />`
- `room.state.phase === "playing"`: `<GameBoard room={room} />` + `<TurnPanel room={room} />`
- `room.state.phase === "finished"`: `<WinnerScreen room={room} />`

- [ ] **Step 1: `TurnPanel.tsx` 작성**

```typescript
// client/src/components/TurnPanel.tsx
import { useEffect, useState, type PointerEvent } from "react";
import type { Room } from "colyseus.js";
import { SHORTCUT_JUNCTION_INDICES, YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function TurnPanel({ room }: { room: Room<MatchState> }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    // 포인터를 이 버튼에 캡처해둔다 — 안 그러면 누른 채로 버튼 밖으로 손가락/마우스가
    // 벗어난 뒤 뗐을 때 onPointerUp이 아예 발생하지 않아 "누른 채로 영원히 멈춘" 상태가 될 수 있다.
    e.currentTarget.setPointerCapture(e.pointerId);
    room.send("throwStart", {});
  }

  function handlePointerUp() {
    room.send("throwRelease", {});
  }

  function moveMyPiece(pieceId: string, useShortcut: boolean) {
    room.send("movePiece", { pieceId, useShortcut });
  }

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && (
        <button type="button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
          누르고 있다가 떼서 던지기
        </button>
      )}

      {isMyTurn && room.state.gaugePhase === "charging" && <p>누르고 있는 중...</p>}

      {isMyTurn && room.state.gaugePhase === "resolved" && (
        <div>
          <p>결과: {YUT_RESULT_LABELS[room.state.lastThrowResult] ?? room.state.lastThrowResult}</p>
          <p>이동할 말을 고르세요:</p>
          {Array.from(room.state.pieces)
            .filter((p) => p.ownerSessionId === room.sessionId && p.positionKind !== "finished")
            .map((p) => {
              const atJunction =
                p.positionKind === "center" ||
                (p.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(p.positionIndex));
              return (
                <PieceMoveButton key={p.id} pieceId={p.id} atJunction={atJunction} onMove={moveMyPiece} />
              );
            })}
        </div>
      )}
    </div>
  );
}

function PieceMoveButton({
  pieceId,
  atJunction,
  onMove,
}: {
  pieceId: string;
  atJunction: boolean;
  onMove: (pieceId: string, useShortcut: boolean) => void;
}) {
  const [useShortcut, setUseShortcut] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => onMove(pieceId, useShortcut)}>
        말 이동 ({pieceId.slice(0, 6)})
      </button>
      {atJunction && (
        <label>
          <input type="checkbox" checked={useShortcut} onChange={(e) => setUseShortcut(e.target.checked)} />
          지름길 사용
        </label>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `WinnerScreen.tsx` 작성**

```typescript
// client/src/components/WinnerScreen.tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function WinnerScreen({ room }: { room: Room<MatchState> }) {
  const winner = room.state.players.get(room.state.winnerSessionId);
  return (
    <div>
      <h2>게임 종료</h2>
      <p>
        {playerLabel(room.state.winnerSessionId, room)}
        {winner?.team ? ` (${winner.team}팀)` : ""}의 승리!
      </p>
    </div>
  );
}
```

- [ ] **Step 3: `App.tsx`를 실제 라우팅으로 교체**

```typescript
// client/src/App.tsx
import { useMatchRoom } from "./game/useMatchRoom";
import { WaitingRoom } from "./components/WaitingRoom";
import { GameBoard } from "./components/GameBoard";
import { TurnPanel } from "./components/TurnPanel";
import { WinnerScreen } from "./components/WinnerScreen";
import "./App.css";

function App() {
  const { status, room } = useMatchRoom();

  if (status !== "connected" || !room) {
    return (
      <div>
        <h1>윷놀이</h1>
        <p>연결 상태: {status}</p>
      </div>
    );
  }

  if (room.state.phase === "waiting") {
    return <WaitingRoom room={room} />;
  }

  if (room.state.phase === "playing") {
    return (
      <div>
        <GameBoard room={room} />
        <TurnPanel room={room} />
      </div>
    );
  }

  return <WinnerScreen room={room} />;
}

export default App;
```

- [ ] **Step 4: 타입체크로 확인**

Run: `npm run build`
Expected: 에러 없음

- [ ] **Step 5: Commit**

```bash
git add client/src/components/TurnPanel.tsx client/src/components/WinnerScreen.tsx client/src/App.tsx
git commit -m "턴 진행/승리 화면 구현 및 App.tsx 라우팅 연결"
```

---

### Task 7: 브라우저 종단간 검증 (4명 실제 플레이)

**Files:** 없음 — 이 프로젝트는 클라이언트에 자동화 테스트 프레임워크가 없으므로(Global Constraints), 실제 브라우저로 검증하는 것이 이 태스크의 산출물이다.

**사전 준비:**
1. 저장소 루트에서 `npm run dev`로 server(2567)+client(5173)를 동시 실행한다.
2. Playwright(이 환경에 MCP 도구로 이미 설치되어 있음 — `mcp__plugin_playwright_playwright__*`)를 사용해 브라우저 탭 4개를 `http://localhost:5173`으로 연다. Playwright를 쓸 수 없는 환경이면 실제 브라우저 탭 4개를 수동으로 열어도 된다.

**검증 시나리오 (전부 통과해야 함):**
1. 4개 탭 모두 "연결 상태: connected"가 뜬다.
2. 4개 탭에서 각각 팀을 A, A, B, B로 나눠 선택한다 — 대기실의 참가자 목록에 각자의 팀이 반영되는지 확인.
3. 4개 탭 모두 캐릭터 2종씩 선택한다.
4. 4개 탭 모두 "준비 완료"를 누른다 — 4번째 사람이 누르는 순간 모든 탭이 동시에 플레이 화면(`GameBoard`+`TurnPanel`)으로 전환되는지 확인 (`room.state.phase`가 `waiting`→`playing`으로 바뀌는 것을 4개 탭 모두에서 실시간으로 확인).
5. 현재 턴인 탭에서만 "누르고 있다가 떼서 던지기" 버튼이 보이고, 나머지 3개 탭에는 "OO님의 턴을 기다리는 중"이 보이는지 확인.
6. 그 버튼을 실제로 누르고 있다가 떼서(pointerdown → 잠깐 대기 → pointerup) 던진다 — 결과(도/개/걸/윷/모/빽도 중 하나)가 표시되는지, 4개 탭 모두에 동일한 결과가 동기화되는지 확인.
7. 이동할 말 버튼을 눌러 말을 이동시킨다 — `GameBoard`에서 그 말이 실제로 이동한 칸에 표시되는지 4개 탭 모두에서 확인.
8. 턴이 다음 사람에게 넘어갔는지(또는 윷/모가 나왔다면 같은 사람에게 유지됐는지) 확인.
9. (선택, 시간이 오래 걸리면 생략 가능) 여러 턴을 반복해 한쪽이 승리할 때까지 진행하고, `WinnerScreen`이 뜨는지 확인.

**문제 발견 시:** 원인을 파악해 관련 태스크(1~6)의 파일을 직접 고치고, 그 태스크의 커밋 이후에 별도의 수정 커밋을 추가한다(예: `git commit -m "GameBoard: 완주 트레이 위치 계산 버그 수정"`). 이 태스크 자체는 새 파일을 만들지 않는다.

- [ ] **Step 1: 위 9가지 시나리오를 순서대로 실행하고 각각 통과하는지 확인한다.**

- [ ] **Step 2: 문제를 찾았다면 수정하고 다시 1번부터 확인한다. 전부 통과하면 완료.**

---

## Self-Review 메모

- **Spec coverage:** REQUIREMENTS.md §1(구조)/§2(캐릭터 선택 UI)/§3(팀 배정 UI)/§4·4.1(턴/제한시간 표시)/§5(던지기 메커니즘, 실제 메시지 그대로 사용)/§6(이동 규칙 — 서버가 이미 처리, 화면은 표시만)/§7(승리 조건 — 서버가 이미 처리, 화면은 표시만)까지 Task 1~7이 커버한다. §8(채팅)과 §10의 Matter.js 연출은 명시적으로 범위 밖(Global Constraints에 기록).
- **Placeholder scan:** 모든 스텝에 실제 코드가 포함되어 있고 "TODO" 등은 없음. Task 7은 자동화 테스트가 없는 이 프로젝트의 확립된 관례에 따라 코드 대신 구체적인 수동/Playwright 검증 시나리오로 대체했다 — 이 자체가 플레이스홀더가 아니라 이 프로젝트의 정상적인 "테스트" 형태다.
- **Type consistency:** `MatchState`/`PieceState`/`PlayerState`(Task 1) → `playerLabel`(Task 3) → `WaitingRoom`/`GameBoard`/`TurnPanel`/`WinnerScreen`(Task 4~6)까지 필드명(`positionKind`/`positionIndex`, `ownerSessionId`, `team`, `characters` 등)을 서버 스키마와 동일하게 유지했다. `room.send(...)`로 보내는 메시지 이름과 페이로드 모양(`pickTeam`/`pickCharacters`/`ready`/`throwStart`/`throwRelease`/`movePiece`)은 `server/src/rooms/MatchRoom.ts`의 실제 `onMessage` 핸들러와 정확히 일치하도록 맞췄다(이 계획에서 새로 만든 게 아니라 이미 구현된 서버 계약을 그대로 호출).
