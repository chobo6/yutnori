# 캐릭터 능력 시스템(교주/성직/마담/의사) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 대기실에서 선택한 캐릭터가 각 말에 고정 배정되고, 이동/잡기 시점에 교주/성직/마담/의사 4종 능력이 서버 권위형으로 판정·적용되게 만든다.

**Architecture:** 능력 확률/조건 판정을 `server/src/game/abilities.ts`의 순수 함수(캐릭터별 하드코딩, RNG 주입 가능)로 구현하고, `MatchRoom.performMove`가 기존 `applyMove` 호출 뒤에 이 함수들을 순서대로 연결한다. 클라이언트는 결과(말 위치) 동기화만 받으며 별도 능력 UI는 만들지 않는다.

**Tech Stack:** TypeScript, Colyseus(`@colyseus/schema`, `@colyseus/testing`), vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-character-abilities-design.md`

## Global Constraints

- 캐릭터 4종 문자열 값: `"교주"`, `"성직"`, `"마담"`, `"의사"` (기존 `MatchRoom.ts`의 `VALID_CHARACTERS`와 동일한 표기 그대로 사용).
- 확률: 교주 80%(0.8), 성직 40%(0.4), 마담 저지 60%(0.6), 의사 35%(0.35) — 스펙 §3.
- "같은 줄"(변) 정의: outer index 1~5=A, 6~10=B, 11~15=C, 16~19=D. `start`/`center`/`finished`는 어느 변에도 속하지 않는다 — 스펙 §2.
- 처리 순서: 마담 저지 확인 → 실패 시 의사 판정 → 의사도 실패 시 성직 판정 — 스펙 §4.
- 잡힘 이벤트는 "원래 이동으로 발생한 잡힘" 다음에 "교주 보너스 전진으로 발생한 잡힘" 순서로 처리한다 — 스펙 §4.
- 교주 보너스 전진은 1회성이다 — 보너스 전진이 새 업기/잡힘을 만들어도 교주 능력이 재귀적으로 다시 발동하지 않는다 — 스펙 §3.1.
- 서버 권위형 원칙 유지: 모든 확률 판정은 서버에서만 일어난다. 클라이언트는 결과 상태만 받는다.
- 클라이언트 능력 발동 알림 UI(토스트 등)는 이번 범위에서 만들지 않는다 — 스펙 §8.
- 클라이언트 타입은 서버 스키마를 손으로 미러링하는 기존 관례를 유지한다(`client/src/game/matchTypes.ts`).
- 서버 순수 게임 로직은 TDD로 작성한다(`server/src/game/*.ts` + 동명 `*.test.ts`) — 기존 확립된 패턴.
- 커밋 메시지는 한국어로, `feat:`/`fix:` 같은 프리픽스 없이 작성한다.

---

## File Structure

- `server/src/game/position.ts` (수정): "같은 줄" 계산 함수 `sideOf`/`sameSide` 추가.
- `server/src/game/pieces.ts` (수정): `Piece.character` 필드, `MoveResult.piggybackedIds` 필드, `samePosition` export 추가.
- `server/src/game/abilities.ts` (신규): 캐릭터 능력 판정 순수 함수 모듈.
- `server/src/rooms/MatchState.ts` (수정): `PieceSchema.character` 필드.
- `server/src/rooms/MatchRoom.ts` (수정): 캐릭터 배정 + 능력 파이프라인 연결 + RNG 주입 옵션.
- `client/src/game/matchTypes.ts` (수정): `PieceState.character` 필드(서버 스키마 미러링).

---

### Task 1: 보드 "같은 줄" 계산 — `position.ts`

**Files:**
- Modify: `server/src/game/position.ts`
- Test: `server/src/game/position.test.ts`

**Interfaces:**
- Produces: `export type Side = "A" | "B" | "C" | "D";` / `export function sideOf(position: Position): Side | null;` / `export function sameSide(a: Position, b: Position): boolean;`

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/game/position.test.ts` 파일 끝에 아래 `describe` 블록을 추가한다(기존 `import` 줄에 `sameSide`, `sideOf`도 추가):

```ts
import { moveBackward, moveForward, sameSide, sideOf, type Position } from "./position";
```

```ts
describe("sideOf", () => {
  it("outer 1~5는 A", () => {
    expect(sideOf({ kind: "outer", index: 1 })).toBe("A");
    expect(sideOf({ kind: "outer", index: 5 })).toBe("A");
  });

  it("outer 6~10은 B", () => {
    expect(sideOf({ kind: "outer", index: 6 })).toBe("B");
    expect(sideOf({ kind: "outer", index: 10 })).toBe("B");
  });

  it("outer 11~15는 C", () => {
    expect(sideOf({ kind: "outer", index: 11 })).toBe("C");
    expect(sideOf({ kind: "outer", index: 15 })).toBe("C");
  });

  it("outer 16~19는 D", () => {
    expect(sideOf({ kind: "outer", index: 16 })).toBe("D");
    expect(sideOf({ kind: "outer", index: 19 })).toBe("D");
  });

  it("start/center/finished는 어느 변에도 속하지 않는다", () => {
    expect(sideOf({ kind: "start" })).toBeNull();
    expect(sideOf({ kind: "center" })).toBeNull();
    expect(sideOf({ kind: "finished" })).toBeNull();
  });
});

describe("sameSide", () => {
  it("같은 변이면 true", () => {
    expect(sameSide({ kind: "outer", index: 2 }, { kind: "outer", index: 4 })).toBe(true);
  });

  it("다른 변이면 false", () => {
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "outer", index: 6 })).toBe(false);
  });

  it("둘 중 하나라도 변이 없으면(start/center/finished) false", () => {
    expect(sameSide({ kind: "start" }, { kind: "outer", index: 3 })).toBe(false);
    expect(sameSide({ kind: "outer", index: 3 }, { kind: "center" })).toBe(false);
    expect(sameSide({ kind: "finished" }, { kind: "start" })).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- position.test.ts`
Expected: FAIL — `sideOf`/`sameSide`가 존재하지 않음(`does not provide an export named 'sideOf'` 등).

- [ ] **Step 3: 구현**

`server/src/game/position.ts` 파일 끝(`moveBackward` 함수 뒤)에 추가:

```ts
export type Side = "A" | "B" | "C" | "D";

const SIDE_RANGES: Array<{ side: Side; min: number; max: number }> = [
  { side: "A", min: 1, max: 5 },
  { side: "B", min: 6, max: 10 },
  { side: "C", min: 11, max: 15 },
  { side: "D", min: 16, max: 19 },
];

/** 보드를 4개의 "변"으로 나눈다(캐릭터 능력의 "같은 줄" 판정용). start/center/finished는 어느 변에도 속하지 않는다. */
export function sideOf(position: Position): Side | null {
  if (position.kind !== "outer") return null;
  const range = SIDE_RANGES.find((r) => position.index >= r.min && position.index <= r.max);
  return range?.side ?? null;
}

export function sameSide(a: Position, b: Position): boolean {
  const sideA = sideOf(a);
  return sideA !== null && sideA === sideOf(b);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- position.test.ts`
Expected: PASS (전체 통과, 신규 테스트 포함)

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/position.ts server/src/game/position.test.ts
git commit -m "보드 '같은 줄' 계산 함수(sideOf/sameSide) 추가"
```

---

### Task 2: 말에 캐릭터 필드 + 업기 결과 노출 — `pieces.ts`

**Files:**
- Modify: `server/src/game/pieces.ts`
- Test: `server/src/game/pieces.test.ts`

**Interfaces:**
- Consumes: 없음(Task 1과 독립).
- Produces: `Piece.character: string` / `MoveResult.piggybackedIds: PieceId[]` / `export function samePosition(a: Position, b: Position): boolean;`(기존 내부 함수를 export로 전환)

**배경:** 교주 능력은 "이번 이동으로 업기가 발생했는지"를 알아야 하는데, 지금 `applyMove`는 업기 대상(`piggybackIds`)을 내부적으로만 계산하고 반환하지 않는다. 이 태스크에서 `MoveResult`에 노출시킨다. 또한 이후 Task 4(능력 로직)가 도착 칸 판정에 기존 `pieces.ts`의 "같은 칸" 규칙을 그대로 재사용할 수 있도록 `samePosition`을 export한다(로직 중복 방지).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/game/pieces.test.ts`의 `piece()` 헬퍼(4~15번 줄)를 아래로 교체한다:

```ts
const TEAM_OF: Record<string, string> = { alice: "A", amy: "A", bob: "B", ben: "B" };

function piece(id: string, ownerId: string, index: number, teamId = TEAM_OF[ownerId] ?? "A", character = "교주"): Piece {
  return {
    id,
    ownerId,
    teamId,
    character,
    position: { kind: "outer", index },
    previousPosition: { kind: "start" },
  };
}
```

기존의 두 직접 리터럴(30~36번 줄 근방의 "빽도" 테스트, 111~122번 줄 근방의 "두 말 모두 start" 테스트)에도 `character: "교주"`를 추가한다:

```ts
it("steps가 -1(빽도)이면 직전 위치로 되돌린다", () => {
  const pieces: Piece[] = [
    {
      id: "p1",
      ownerId: "alice",
      teamId: "A",
      character: "교주",
      position: { kind: "outer", index: 7 },
      previousPosition: { kind: "outer", index: 4 },
    },
  ];
  const { pieces: result } = applyMove(pieces, "p1", -1, false);
  expect(result[0].position).toEqual({ kind: "outer", index: 4 });
});
```

```ts
it("같은 주인의 두 말이 모두 start에 있을 때, 하나를 출발시키면 다른 하나는 start에 남아 있다", () => {
  const pieces: Piece[] = [
    { id: "p1", ownerId: "alice", teamId: "A", character: "교주", position: { kind: "start" }, previousPosition: { kind: "start" } },
    { id: "p2", ownerId: "alice", teamId: "A", character: "성직", position: { kind: "start" }, previousPosition: { kind: "start" } },
  ];
  const { pieces: result } = applyMove(pieces, "p1", 1, false);
  const p1 = result.find((p) => p.id === "p1")!;
  const p2 = result.find((p) => p.id === "p2")!;
  expect(p1.position).toEqual({ kind: "outer", index: 1 });
  expect(p2.position).toEqual({ kind: "start" });
});
```

파일 끝(마지막 `});` 앞, `describe("applyMove", ...)` 블록 안)에 아래 두 테스트를 추가한다:

```ts
it("업힌 말이 있으면 piggybackedIds에 그 말들의 id가 담긴다", () => {
  const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
  const { piggybackedIds } = applyMove(pieces, "p1", 2, false);
  expect(piggybackedIds).toEqual(["p2"]);
});

it("업힌 말이 없으면 piggybackedIds는 빈 배열이다", () => {
  const pieces = [piece("p1", "alice", 3)];
  const { piggybackedIds } = applyMove(pieces, "p1", 2, false);
  expect(piggybackedIds).toEqual([]);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- pieces.test.ts`
Expected: FAIL — 타입 에러(`character` 속성 없음) 및 `piggybackedIds`가 `undefined`라 `toEqual` 실패.

- [ ] **Step 3: 구현**

`server/src/game/pieces.ts`를 아래로 교체한다:

```ts
import { moveBackward, moveForward, type Position } from "./position";

export type PieceId = string;

export interface Piece {
  id: PieceId;
  ownerId: string;
  /** 소속 팀 ("A" | "B"). 잡기는 팀 기준, 업기는 주인 기준으로 판정한다 (REQUIREMENTS.md §6). */
  teamId: string;
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  character: string;
  position: Position;
  previousPosition: Position;
}

export interface MoveResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
  /** 이번 이동으로 함께 움직인(업힌) 같은 주인의 다른 말 id들. 교주 능력 판정에 쓰인다(abilities.ts). */
  piggybackedIds: PieceId[];
}

export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
  return false;
}

export function applyMove(
  pieces: Piece[],
  pieceId: PieceId,
  steps: number,
  useShortcut: boolean,
): MoveResult {
  const mover = pieces.find((p) => p.id === pieceId);
  if (!mover) {
    throw new Error(`말을 찾을 수 없습니다: ${pieceId}`);
  }

  const fromPosition = mover.position;
  const newPosition =
    steps === -1
      ? moveBackward(mover.position, mover.previousPosition)
      : moveForward(mover.position, steps, useShortcut);

  // 같은 칸에 있던 같은 주인의 다른 말 (업기 대상)
  const piggybackIds = new Set(
    pieces
      .filter((p) => p.id !== pieceId && p.ownerId === mover.ownerId && samePosition(p.position, fromPosition))
      .map((p) => p.id),
  );

  // 도착 칸에 있던 상대 "팀" 말 (잡기 대상) — 같은 팀 동료의 말은 잡지 않는다 (REQUIREMENTS.md §6)
  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.teamId !== mover.teamId && samePosition(p.position, newPosition) && newPosition.kind !== "start" && newPosition.kind !== "finished")
    .map((p) => p.id);
  const capturedSet = new Set(capturedPieceIds);

  const result = pieces.map((p) => {
    if (p.id === pieceId || piggybackIds.has(p.id)) {
      return { ...p, position: newPosition, previousPosition: p.position };
    }
    if (capturedSet.has(p.id)) {
      return { ...p, position: { kind: "start" as const }, previousPosition: p.position };
    }
    return p;
  });

  return { pieces: result, capturedPieceIds, piggybackedIds: Array.from(piggybackIds) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- pieces.test.ts`
Expected: PASS (전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/pieces.ts server/src/game/pieces.test.ts
git commit -m "말에 character 필드 추가, applyMove가 piggybackedIds도 반환하도록 확장"
```

---

### Task 3: 캐릭터 배정을 서버 상태에 반영 — `MatchState.ts` / `MatchRoom.ts`

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Piece.character`.
- Produces: `PieceSchema.character: string` (Colyseus 상태에 노출되는 캐릭터 값). `toGamePieces()`가 반환하는 `Piece[]`에 `character`가 채워짐 — 이후 Task 5가 이 값을 이용해 능력 판정을 수행한다.

**배경:** 이 태스크는 능력 로직 없이 "말에 캐릭터가 실제로 배정되고 상태 동기화에 실려 나가는지"만 만든다. `Piece.character`가 필수 필드가 되었으므로, `MatchRoom.ts`의 `toGamePieces()`를 여기서 같이 고쳐야 서버 패키지가 계속 타입체크를 통과한다(Task 2만으로는 `toGamePieces()`가 `character`를 채우지 않아 타입 에러가 남는다).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.test.ts`의 첫 번째 `it` 블록("4명이 팀/캐릭터를 정하고...") 바로 뒤에 아래 테스트를 추가한다:

```ts
it("게임 시작 시 각 말에 플레이어가 고른 캐릭터가 순서대로 배정된다", async () => {
  const { room } = await setupFourPlayers(colyseus);
  const players = Array.from(room.state.players.values());
  for (const player of players) {
    const piece0 = room.state.pieces.find((p) => p.id === `${player.sessionId}-0`)!;
    const piece1 = room.state.pieces.find((p) => p.id === `${player.sessionId}-1`)!;
    expect(piece0.character).toBe(player.characters[0]);
    expect(piece1.character).toBe(player.characters[1]);
  }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: FAIL — `piece0.character`가 빈 문자열(`""`)이라 `player.characters[0]`(예: `"교주"`)와 다름.

- [ ] **Step 3: 구현**

`server/src/rooms/MatchState.ts`의 `PieceSchema` 클래스에 필드를 추가한다:

```ts
export class PieceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerSessionId: string = "";
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  @type("string") character: string = "";
  @type("string") positionKind: string = "start"; // "start" | "outer" | "center" | "finished"
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
}
```

`server/src/rooms/MatchRoom.ts`의 `toGamePieces()`를 아래로 교체한다:

```ts
  /** PieceSchema[] -> 순수 Piece[] 변환 (teamId는 players에서 조회해 채운다). */
  private toGamePieces(): Piece[] {
    return this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      teamId: this.state.players.get(p.ownerSessionId)?.team ?? "",
      character: p.character,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));
  }
```

`maybeStartGame()` 안의 말 생성 루프를 아래로 교체한다:

```ts
    this.state.pieces.clear();
    for (const sessionId of [...teamA, ...teamB]) {
      const owner = this.state.players.get(sessionId)!;
      for (let i = 0; i < 2; i++) {
        const piece = new PieceSchema();
        piece.id = `${sessionId}-${i}`;
        piece.ownerSessionId = sessionId;
        piece.character = owner.characters[i];
        piece.positionKind = "start";
        piece.positionIndex = -1;
        piece.previousPositionKind = "start";
        piece.previousPositionIndex = -1;
        this.state.pieces.push(piece);
      }
    }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- MatchRoom.test.ts`
Expected: PASS (전체 통과)

Run: `npm run build --workspace server`
Expected: 타입 에러 없음(`tsc --noEmit` 성공)

- [ ] **Step 5: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "게임 시작 시 대기실에서 고른 캐릭터를 각 말에 고정 배정"
```

---

### Task 4: 캐릭터 능력 판정 모듈 — `abilities.ts`

**Files:**
- Create: `server/src/game/abilities.ts`
- Test: `server/src/game/abilities.test.ts`

**Interfaces:**
- Consumes: Task 1의 `sameSide` (from `./position`), Task 2의 `Piece`/`PieceId`/`samePosition` (from `./pieces`), `moveForward` (from `./position`, 기존).
- Produces:
  - `export type Rng = () => number;` — `[0, 1)` 범위의 난수를 반환하는 함수. 테스트에서 결정적 값 주입용.
  - `export interface CaptureRecord { pieceId: PieceId; teamId: string; originalPosition: Position; }`
  - `export interface GyojuBonusResult { pieces: Piece[]; capturedPieceIds: PieceId[]; }`
  - `export function applyGyojuBonus(pieces: Piece[], moverId: PieceId, piggybackedIds: PieceId[], rng: Rng): GyojuBonusResult;`
  - `export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): Piece[];`
  - Task 5가 이 4개 export를 그대로 가져다 `MatchRoom.performMove`에 연결한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/game/abilities.test.ts` 파일을 새로 만든다:

```ts
import { describe, expect, it } from "vitest";
import { applyGyojuBonus, resolveCaptureResponses, type CaptureRecord, type Rng } from "./abilities";
import type { Piece } from "./pieces";

const ALWAYS_SUCCEED: Rng = () => 0;
const ALWAYS_FAIL: Rng = () => 0.99;

function piece(id: string, ownerId: string, teamId: string, character: string, index: number): Piece {
  return {
    id,
    ownerId,
    teamId,
    character,
    position: { kind: "outer", index },
    previousPosition: { kind: "start" },
  };
}

describe("applyGyojuBonus", () => {
  it("이동한 말이 교주가 아니면 아무 일도 없다", () => {
    const pieces = [piece("p1", "alice", "A", "성직", 8), piece("p2", "alice", "A", "의사", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
    expect(result.capturedPieceIds).toEqual([]);
  });

  it("업힌 말이 없으면(piggybackedIds 빈 배열) 발동하지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", [], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
  });

  it("80% 확률 실패 시 보너스 전진이 일어나지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_FAIL);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 });
  });

  it("확률 성공 시 업힌 말 전원이 1칸 추가 전진한다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    const p2 = result.pieces.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 });
    expect(p2.position).toEqual({ kind: "outer", index: 9 });
  });

  it("보너스 전진 칸에 상대 말이 있으면 잡아서 capturedPieceIds에 담는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8),
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy1", "bob", "B", "마담", 9),
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const enemy = result.pieces.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(result.capturedPieceIds).toEqual(["enemy1"]);
  });

  it("같은 줄에 상대 마담이 있으면 저지되어(확률 성공값이어도) 발동하지 않는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8), // 변 B(6~10)
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 7), // 변 B, 상대팀
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 }); // 저지되어 전진 없음
  });

  it("상대 마담이 다른 줄이면 저지되지 않는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8), // 변 B
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 12), // 변 C, 다른 줄
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 }); // 정상 발동
  });
});

describe("resolveCaptureResponses", () => {
  function capture(pieceId: string, teamId: string, index: number): CaptureRecord {
    return { pieceId, teamId, originalPosition: { kind: "outer", index } };
  }

  it("잡힌 팀에 조건을 만족하는 의사가 있고 확률이 성공하면 원위치로 복원한다", () => {
    const pieces = [
      piece("victim", "bob", "B", "성직", 0), // 이미 start로 이동된 상태를 가정(0 index는 편의상 표시용, 실제로는 start)
      piece("uisa", "bob", "B", "의사", 7), // victim의 원래 칸(8)과 같은 줄(B)
    ];
    pieces[0].position = { kind: "start" }; // applyMove가 이미 잡아 옮겨놓은 상태
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
  });

  it("의사가 실패하면 이어서 성직이 판정해 성공 시 성직 위치로 순간이동시킨다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    // UISA_CHANCE(0.35) 미만이면 성공 - 0.37은 실패, SEONGJIK_CHANCE(0.4) 미만이면 성공 - 0.37은 성공
    const rng: Rng = () => 0.37;
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
  });

  it("의사/성직 둘 다 없거나 실패하면 잡힌 상태(start) 그대로 유지된다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("uisa", "bob", "B", "의사", 7)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_FAIL);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" });
  });

  it("잡힌 말 자신이 의사/성직이면 그 능력은 자기 자신에 대해 발동하지 않는다", () => {
    const pieces = [piece("uisa", "bob", "B", "의사", 0)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("uisa", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "uisa")!;
    expect(victim.position).toEqual({ kind: "start" }); // 무효화되지 않음
  });

  it("의사는 '같은 줄'이 아니면 발동 후보에서 제외된다(성직으로 넘어간다)", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 12), // 변 C — victim의 원래 칸(8, 변 B)과 다른 줄
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 }); // 의사는 제외, 성직이 성공
  });

  it("성직은 '같은 줄' 제한이 없다 — 팀 어디에 있어도 발동 후보다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("seongjik", "bob", "B", "성직", 15)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
  });

  it("같은 줄에 상대 마담이 있으면 의사/성직 모두 저지되어 정상 잡힘으로 확정된다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
      piece("seongjik", "bob", "B", "성직", 15),
      piece("enemy-madam", "alice", "A", "마담", 9), // victim 원래 칸(8)과 같은 줄(B), 상대팀(A)
    ];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" }); // 저지되어 그대로 잡힘
  });

  it("같은 팀에 의사가 2개 있으면 하나라도 성공할 때까지 순회한다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa1", "bob", "B", "의사", 6), // 첫 번째 후보
      piece("uisa2", "bob", "B", "의사", 9), // 두 번째 후보
    ];
    pieces[0].position = { kind: "start" };
    let call = 0;
    // 첫 번째 의사(uisa1) 시도만 실패(0.5 >= 0.35), 두 번째(uisa2)는 성공(0.1 < 0.35)
    const rng: Rng = () => (call++ === 0 ? 0.5 : 0.1);
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- abilities.test.ts`
Expected: FAIL — `./abilities` 모듈이 존재하지 않음.

- [ ] **Step 3: 구현**

`server/src/game/abilities.ts` 파일을 새로 만든다:

```ts
import { moveForward, sameSide, type Position } from "./position";
import { samePosition, type Piece, type PieceId } from "./pieces";

/** [0, 1) 범위의 난수를 반환하는 함수. 테스트에서 결정적 값을 주입하기 위한 타입. */
export type Rng = () => number;

export const GYOJU_CHANCE = 0.8;
export const SEONGJIK_CHANCE = 0.4;
export const MADAM_BLOCK_CHANCE = 0.6;
export const UISA_CHANCE = 0.35;

/** 잡힘 이벤트 1건 — 의사/성직/마담 판정에 필요한 정보. */
export interface CaptureRecord {
  pieceId: PieceId;
  /** 잡힌 말의 소속 팀 — 이 팀의 의사/성직이 반응 후보가 된다. */
  teamId: string;
  /** 잡히기 직전 위치 — 의사의 "같은 줄" 판정 기준이자, 무효화 시 복원할 좌표. */
  originalPosition: Position;
}

export interface GyojuBonusResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
}

function roll(chance: number, rng: Rng): boolean {
  return rng() < chance;
}

function onBoard(position: Position): boolean {
  return position.kind === "outer" || position.kind === "center";
}

/**
 * eventPosition과 같은 줄에 있는 상대(abilityOwnerTeamId 기준 적팀)의 마담이 하나라도 저지에
 * 성공하면 true. 마담이 여럿이면 각각 독립적으로 판정하고, 하나라도 성공하면 즉시 저지된다.
 */
function isBlockedByMadam(pieces: Piece[], abilityOwnerTeamId: string, eventPosition: Position, rng: Rng): boolean {
  const enemyMadams = pieces.filter(
    (p) => p.character === "마담" && p.teamId !== abilityOwnerTeamId && onBoard(p.position),
  );
  for (const madam of enemyMadams) {
    if (sameSide(madam.position, eventPosition) && roll(MADAM_BLOCK_CHANCE, rng)) {
      return true;
    }
  }
  return false;
}

/**
 * 교주 능력(스펙 §3.1): 이번 턴에 이동한 말이 교주이고 업기가 발생했다면, 80% 확률로 업힌
 * 말 전원이 1칸 추가 전진한다. 보너스 전진 칸에 상대 말이 있으면 정상적으로 잡는다.
 * 이 함수 자체는 재귀적으로 다시 호출되지 않는다(1회성) — 호출부(MatchRoom)가 보장한다.
 */
export function applyGyojuBonus(
  pieces: Piece[],
  moverId: PieceId,
  piggybackedIds: PieceId[],
  rng: Rng,
): GyojuBonusResult {
  const mover = pieces.find((p) => p.id === moverId);
  if (!mover || mover.character !== "교주" || piggybackedIds.length === 0) {
    return { pieces, capturedPieceIds: [] };
  }

  if (isBlockedByMadam(pieces, mover.teamId, mover.position, rng)) {
    return { pieces, capturedPieceIds: [] };
  }

  if (!roll(GYOJU_CHANCE, rng)) {
    return { pieces, capturedPieceIds: [] };
  }

  const groupIds = new Set([moverId, ...piggybackedIds]);
  const newPosition = moveForward(mover.position, 1, false);

  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.teamId !== mover.teamId && !groupIds.has(p.id) && samePosition(p.position, newPosition))
    .map((p) => p.id);
  const capturedSet = new Set(capturedPieceIds);

  const result = pieces.map((p) => {
    if (groupIds.has(p.id)) {
      return { ...p, position: newPosition, previousPosition: p.position };
    }
    if (capturedSet.has(p.id)) {
      return { ...p, position: { kind: "start" as const }, previousPosition: p.position };
    }
    return p;
  });

  return { pieces: result, capturedPieceIds };
}

function tryUisa(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] | null {
  const candidates = pieces.filter(
    (p) =>
      p.character === "의사" &&
      p.teamId === capture.teamId &&
      p.id !== capture.pieceId &&
      onBoard(p.position) &&
      sameSide(p.position, capture.originalPosition),
  );
  for (const uisa of candidates) {
    if (isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng)) continue;
    if (roll(UISA_CHANCE, rng)) {
      return pieces.map((p) => (p.id === capture.pieceId ? { ...p, position: capture.originalPosition } : p));
    }
  }
  return null;
}

function trySeongjik(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] | null {
  const candidates = pieces.filter(
    (p) => p.character === "성직" && p.teamId === capture.teamId && p.id !== capture.pieceId && onBoard(p.position),
  );
  for (const seongjik of candidates) {
    if (isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng)) continue;
    if (roll(SEONGJIK_CHANCE, rng)) {
      return pieces.map((p) => (p.id === capture.pieceId ? { ...p, position: seongjik.position } : p));
    }
  }
  return null;
}

function resolveOneCapture(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] {
  const restored = tryUisa(pieces, capture, rng);
  if (restored) return restored;

  const redirected = trySeongjik(pieces, capture, rng);
  if (redirected) return redirected;

  return pieces;
}

/**
 * 잡힘 이벤트들을 스펙 §4 순서(의사 우선 -> 실패 시 성직)로 처리한다. captures 배열은
 * "발생 순서대로" 전달되어야 한다(원래 이동의 잡힘 -> 교주 보너스 전진의 잡힘 순).
 */
export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): Piece[] {
  let result = pieces;
  for (const capture of captures) {
    result = resolveOneCapture(result, capture, rng);
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- abilities.test.ts`
Expected: PASS (전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/abilities.ts server/src/game/abilities.test.ts
git commit -m "캐릭터 능력(교주/성직/마담/의사) 판정 순수 함수 모듈 추가"
```

---

### Task 5: `MatchRoom`에 능력 파이프라인 연결

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts`
- Test: Create `server/src/rooms/MatchRoom.abilities.test.ts`

**Interfaces:**
- Consumes: Task 4의 `applyGyojuBonus`, `resolveCaptureResponses`, `CaptureRecord`, `Rng` (from `../game/abilities`). Task 2의 `MoveResult.piggybackedIds`.
- Produces: `MatchRoom`의 `onCreate` 옵션에 `rng?: Rng` 추가(기존 `throwTimeoutMs`/`moveTimeoutMs`와 동일한 방식으로 테스트에서 주입 가능).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchRoom.abilities.test.ts` 파일을 새로 만든다:

```ts
// server/src/rooms/MatchRoom.abilities.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { MatchState } from "./MatchState";

function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** wavePosition 상승 초입 근처를 노려 "모"(5칸) 결과를 안정적으로 얻는다 — 기존 테스트와 동일한 관례. */
const MO_TIMING_MS = 5;

async function setupTeams(
  colyseus: ColyseusTestServer,
  characterPicks: [string, string][],
  roomOptions: Record<string, unknown> = {},
) {
  const room = await colyseus.createRoom<MatchState>("match", roomOptions);
  const clients = await Promise.all([
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
  ]);

  const teams = ["A", "A", "B", "B"];
  for (let i = 0; i < 4; i++) {
    clients[i].send("pickTeam", { team: teams[i] });
    clients[i].send("pickCharacters", { characters: characterPicks[i] });
  }
  await flush();
  for (const client of clients) client.send("ready", {});
  await flush();

  return { room, clients };
}

function placeAt(room: { state: MatchState }, pieceId: string, index: number) {
  const piece = room.state.pieces.find((p) => p.id === pieceId)!;
  piece.positionKind = "outer";
  piece.positionIndex = index;
  piece.previousPositionKind = "outer";
  piece.previousPositionIndex = index;
}

describe("MatchRoom 캐릭터 능력 통합", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  // turnOrder = [teamA[0], teamB[0], teamA[1], teamB[1]] (buildTurnOrder, turns.ts)에서
  // teamA[0]/teamA[1]가 clients[0]/clients[1] 중 어느 쪽인지는 join 처리 순서에 따라 달라질 수
  // 있다 — 팀 배정(clients[i]가 스스로 보낸 pickTeam) 자체는 결정적이지만, 같은 팀 내 두 명 중
  // 누가 "0번"이 되는지는 아니다. 그래서 아래 테스트들은 절대 clients[0]을 무브해로 가정하지
  // 않는다: (1) 이동시켜야 하는 캐릭터(교주 등)가 필요한 경우 같은 팀의 두 클라이언트에게
  // 항상 동일한 캐릭터 조합을 주고, (2) 실제로 첫 턴을 받은 세션을
  // `room.state.turnOrder[room.state.currentTurnIndex]`로 조회해서 사용한다. 팀 자체(A/B)는
  // 각 클라이언트가 스스로 선언하므로 clients[2]/clients[3]가 항상 팀B라는 점은 안전하게 쓸 수
  // 있다.

  it("교주가 업힌 상태로 이동해 능력이 성공하면 1칸 더 전진한다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"], // 팀A 두 명 모두 동일 — 누가 첫 턴이든 교주가 움직인다
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 모든 확률 판정 성공
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0` });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    const ally = room.state.pieces.find((p) => p.id === `${sessionId}-1`)!;
    expect(mover.positionIndex).toBe(9); // 3 + 5(모) + 1(보너스)
    expect(ally.positionIndex).toBe(9);
  });

  it("교주 능력이 실패하면 보너스 전진 없이 정상 이동만 일어난다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0.99 }, // 모든 확률 판정 실패
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0` });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    const ally = room.state.pieces.find((p) => p.id === `${sessionId}-1`)!;
    expect(mover.positionIndex).toBe(8); // 3 + 5(모), 보너스 없음
    expect(ally.positionIndex).toBe(8);
  });

  it("상대 마담이 도착 칸과 같은 줄에 있으면 교주 능력이 저지된다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["교주", "성직"],
        ["교주", "성직"],
        ["마담", "의사"],
        ["마담", "의사"],
      ],
      { rng: () => 0 }, // 저지가 없다면 반드시 성공할 값
    );

    const sessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === sessionId)!;
    const enemyMadamId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B(스스로 선언한 팀)
    placeAt(room, `${sessionId}-0`, 3);
    placeAt(room, `${sessionId}-1`, 3);
    placeAt(room, enemyMadamId, 7); // 도착 칸(8)과 같은 줄(B: 6~10)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: `${sessionId}-0` });
    await flush();

    const mover = room.state.pieces.find((p) => p.id === `${sessionId}-0`)!;
    expect(mover.positionIndex).toBe(8); // 저지되어 보너스 없음
  });

  it("같은 줄의 의사가 잡힘을 무효화하면 잡힌 말이 원위치에 남는다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"], // 팀A — 이동할 말의 캐릭터는 이 능력과 무관, 유효한 조합이면 된다
        ["성직", "의사"],
        ["의사", "성직"], // 팀B — 의사가 잡힌 말을 지킨다
        ["의사", "성직"],
      ],
      { rng: () => 0 }, // 마담이 없으므로 저지 없이 항상 의사가 성공
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`; // clients[3]는 항상 팀B
    const uisaId = `${clients[2].sessionId}-0`; // clients[2]는 항상 팀B, 캐릭터 "의사"

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8); // 3 + 5(모)와 동일한 도착 칸
    placeAt(room, uisaId, 7); // victim과 같은 줄(B)

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId });
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(8); // 잡히지 않은 것으로 복원
  });

  it("의사가 실패하면 이어서 성직이 판정해 성공 시 성직 위치로 순간이동한다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0.37 }, // 의사(0.35 미만) 실패, 성직(0.4 미만) 성공 — 마담 없음
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;
    const seongjikId = `${clients[2].sessionId}-1`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7); // 같은 줄(B) — 의사는 발동 시도하지만 실패
    placeAt(room, seongjikId, 12); // 다른 줄(C)이어도 성직은 제한 없음

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId });
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("outer");
    expect(victim.positionIndex).toBe(12); // 성직 위치로 순간이동
  });

  it("의사와 성직이 모두 실패하면 정상적으로 시작점으로 돌아간다", async () => {
    const { room, clients } = await setupTeams(
      colyseus,
      [
        ["성직", "의사"],
        ["성직", "의사"],
        ["의사", "성직"],
        ["의사", "성직"],
      ],
      { rng: () => 0.99 }, // 둘 다 실패
    );

    const moverSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const moverClient = clients.find((c) => c.sessionId === moverSessionId)!;
    const moverId = `${moverSessionId}-0`;
    const victimId = `${clients[3].sessionId}-0`;
    const uisaId = `${clients[2].sessionId}-0`;
    const seongjikId = `${clients[2].sessionId}-1`;

    placeAt(room, moverId, 3);
    placeAt(room, victimId, 8);
    placeAt(room, uisaId, 7);
    placeAt(room, seongjikId, 12);

    moverClient.send("throwStart", {});
    await flush(MO_TIMING_MS);
    moverClient.send("throwRelease", {});
    await flush();
    moverClient.send("movePiece", { pieceId: moverId });
    await flush();

    const victim = room.state.pieces.find((p) => p.id === victimId)!;
    expect(victim.positionKind).toBe("start"); // 정상적으로 잡힘
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- MatchRoom.abilities.test.ts`
Expected: FAIL — `rng` 옵션이 아직 없어 항상 `Math.random`을 쓰므로 확률적으로 기대값과 다르게 나옴(비결정적으로 실패), 그리고 애초에 능력 파이프라인 자체가 연결되어 있지 않아 보너스 전진/의사/성직 효과가 전혀 일어나지 않음(예: 첫 테스트는 `mover.positionIndex`가 8로 나와 기대값 9와 불일치).

- [ ] **Step 3: 구현**

`server/src/rooms/MatchRoom.ts`의 import 구문을 아래로 교체(맨 위 2~5번 줄):

```ts
import { Room, Client } from "colyseus";
import { applyMove, type Piece } from "../game/pieces";
import { applyGyojuBonus, resolveCaptureResponses, type CaptureRecord, type Rng } from "../game/abilities";
import { DEFAULT_GAUGE_CYCLE_MS, resolveThrow, YUT_STEPS, type YutResult } from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { MatchState, PieceSchema, PlayerState, fromSchemaPosition, toSchemaPosition } from "./MatchState";
```

클래스 필드 선언부(`throwTimeoutMs`/`moveTimeoutMs` 옆)에 `rng` 필드를 추가:

```ts
  private throwTimeoutMs = DEFAULT_THROW_TIMEOUT_MS;
  private moveTimeoutMs = DEFAULT_MOVE_TIMEOUT_MS;
  /** 능력 확률 판정에 쓰는 난수 함수. 기본은 Math.random, 테스트에서 결정적 값 주입 가능. */
  private rng: Rng = Math.random;
```

`onCreate`의 옵션 타입과 대입부를 교체:

```ts
  onCreate(options?: { throwTimeoutMs?: number; moveTimeoutMs?: number; rng?: Rng }) {
    this.setState(new MatchState());
    if (options?.throwTimeoutMs) this.throwTimeoutMs = options.throwTimeoutMs;
    if (options?.moveTimeoutMs) this.moveTimeoutMs = options.moveTimeoutMs;
    if (options?.rng) this.rng = options.rng;
```

(이 줄들 뒤에 이어지는 `this.onMessage(...)` 블록들은 그대로 둔다.)

`performMove` 메서드를 아래로 교체:

```ts
  /** 실제 movePiece와 시간초과 자동 말 선택이 공유하는 "이동 실행" 로직. */
  private performMove(sessionId: string, pieceId: string, useShortcut: boolean) {
    if (!this.isCurrentTurn(sessionId)) return;
    const result = this.pendingThrows.get(sessionId);
    if (!result) return;

    const targetPiece = this.state.pieces.find((p) => p.id === pieceId);
    if (!targetPiece || targetPiece.ownerSessionId !== sessionId) return;
    // 이미 완주한 말은 이동 대상이 될 수 없다 (applyMove가 예외를 던진다).
    if (targetPiece.positionKind === "finished") return;

    const pieces: Piece[] = this.toGamePieces();

    const { pieces: afterMove, capturedPieceIds, piggybackedIds } = applyMove(
      pieces,
      pieceId,
      YUT_STEPS[result],
      useShortcut,
    );

    // 교주 능력(REQUIREMENTS.md 능력 스펙 §3.1) — 이동한 말이 교주이고 업기가 발생했으면
    // 80% 확률로 업힌 말 전원이 1칸 더 전진한다. 이 보너스 전진이 새로 만든 잡힘도 아래
    // resolveCaptureResponses에 함께 넘긴다(원래 이동의 잡힘 다음 순서로).
    const bonus = applyGyojuBonus(afterMove, pieceId, piggybackedIds, this.rng);

    const mainCaptureRecords: CaptureRecord[] = capturedPieceIds.map((id) => {
      const original = pieces.find((p) => p.id === id)!;
      return { pieceId: id, teamId: original.teamId, originalPosition: original.position };
    });
    const bonusCaptureRecords: CaptureRecord[] = bonus.capturedPieceIds.map((id) => {
      const original = afterMove.find((p) => p.id === id)!;
      return { pieceId: id, teamId: original.teamId, originalPosition: original.position };
    });

    const updated = resolveCaptureResponses(bonus.pieces, [...mainCaptureRecords, ...bonusCaptureRecords], this.rng);

    for (const updatedPiece of updated) {
      const schemaPiece = this.state.pieces.find((p) => p.id === updatedPiece.id)!;
      const pos = toSchemaPosition(updatedPiece.position);
      const prevPos = toSchemaPosition(updatedPiece.previousPosition);
      schemaPiece.positionKind = pos.kind;
      schemaPiece.positionIndex = pos.index;
      schemaPiece.previousPositionKind = prevPos.kind;
      schemaPiece.previousPositionIndex = prevPos.index;
    }

    // 던지기 결과 소진 — 서버 기록(pendingThrows)과 동기화 상태(lastThrowResult)를 항상 함께 비운다.
    this.pendingThrows.delete(sessionId);
    this.state.lastThrowResult = "";
    this.state.gaugePhase = "idle";

    const finalPieces: Piece[] = this.toGamePieces();

    if (checkWinner(finalPieces, sessionId)) {
      this.state.phase = "finished";
      this.state.winnerSessionId = sessionId;
      this.state.turnDeadlineAt = 0;
      return;
    }

    this.state.currentTurnIndex = nextTurnIndex(
      this.state.currentTurnIndex,
      Array.from(this.state.turnOrder),
      result,
    );
    this.armThrowTimeout(this.state.turnOrder[this.state.currentTurnIndex]);
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- MatchRoom.abilities.test.ts`
Expected: PASS (전체 통과)

Run: `npm test --workspace server`
Expected: 서버 전체 테스트 스위트 통과(기존 `MatchRoom.test.ts`, `MatchRoom.fullGame.test.ts` 포함 — 이 둘은 `rng`를 주입하지 않으므로 `Math.random` 기본값을 쓰고, 능력이 확률적으로 발동해도 승리 조건 등 기존 단언은 영향받지 않아야 한다).

- [ ] **Step 5: 커밋**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.abilities.test.ts
git commit -m "MatchRoom에 캐릭터 능력 판정 파이프라인 연결"
```

---

### Task 6: 클라이언트 타입에 캐릭터 필드 반영

**Files:**
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Consumes: Task 3의 서버 `PieceSchema.character` (client는 서버 스키마를 손으로 미러링하는 기존 관례를 따른다 — CLAUDE.md 참고).
- Produces: `PieceState.character: string` — 이후 클라이언트 화면에서 캐릭터 이름 표시가 필요해지면 이 필드를 사용한다(이번 태스크 범위에는 화면 표시 변경 없음 — 스펙 §5.4/§8, 능력 발동 UI는 만들지 않기로 합의됨).

**배경:** 서버 스키마가 바뀌면 이 파일을 반드시 같이 고쳐야 한다는 기존 관례(CLAUDE.md)를 따른다. client에는 자동화 테스트가 없으므로(CLAUDE.md) 이 태스크는 타입 정합성만 `npm run build`로 확인한다.

- [ ] **Step 1: 구현**

`client/src/game/matchTypes.ts`의 `PieceState` 인터페이스를 아래로 교체:

```ts
export interface PieceState {
  id: string;
  ownerSessionId: string;
  character: string;
  positionKind: PositionKind;
  positionIndex: number;
  previousPositionKind: PositionKind;
  previousPositionIndex: number;
}
```

- [ ] **Step 2: 타입체크 확인**

Run: `npm run build --workspace client`
Expected: 타입 에러 없음(`tsc -b && vite build` 성공). `PieceState.character`를 아직 아무도 읽지 않으므로 미사용 필드로 인한 에러는 없다(구조적 타입이라 필드 추가는 항상 안전).

- [ ] **Step 3: 커밋**

```bash
git add client/src/game/matchTypes.ts
git commit -m "클라이언트 PieceState 타입에 character 필드 반영(서버 스키마 미러링)"
```

---

## Self-Review 결과

- **스펙 커버리지:** §1(말–캐릭터 결합)은 Task 3, §2("같은 줄")는 Task 1, §3.1(교주)·§3.4(마담)는 Task 4의 `applyGyojuBonus`/`isBlockedByMadam`, §3.2(성직)·§3.3(의사)는 Task 4의 `tryUisa`/`trySeongjik`, §4(처리 순서)는 Task 4의 `resolveOneCapture` + Task 5의 캡처 레코드 조합 순서, §5(데이터 모델)는 Task 2/3/6, §6(구현 아키텍처, A안)은 Task 4의 구조 자체, §8(클라이언트 UI 범위 제외)은 Task 6에서 명시적으로 준수. 누락 없음.
- **플레이스홀더 스캔:** "TBD"/"TODO"/"적절히 처리" 패턴 없음. 모든 스텝에 실행 가능한 실제 코드 포함.
- **타입 일관성 확인:** `Piece.character`(Task 2) → `abilities.ts`(Task 4)의 `p.character` 사용 → `PieceSchema.character`(Task 3) → `toGamePieces()`의 `character: p.character`(Task 3) → `MatchRoom.performMove`의 `applyGyojuBonus`/`resolveCaptureResponses` 시그니처(Task 5) → `client/matchTypes.ts`의 `PieceState.character`(Task 6)까지 필드명/타입이 전부 `string`으로 일치. `MoveResult.piggybackedIds`(Task 2)는 Task 5의 `performMove`에서 동일한 이름으로 구조분해된다. `CaptureRecord`/`GyojuBonusResult`/`Rng`는 Task 4에서 정의되고 Task 5에서 그대로 import된다 — 이름 불일치 없음.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-21-character-abilities.md`. 실행 방식을 선택해주세요:

1. **Subagent-Driven (권장)** — 태스크마다 새 서브에이전트를 붙여 구현시키고, 태스크 사이사이 리뷰하며 빠르게 진행합니다.
2. **Inline Execution** — 이 세션에서 executing-plans로 배치 실행하고, 체크포인트마다 검토합니다.

어느 쪽으로 진행할까요?
