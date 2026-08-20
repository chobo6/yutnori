# 윷놀이 핵심 게임 엔진 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 권위형 윷놀이 매치를 4명(2팀×2인) 종단간으로 플레이 가능하게 만든다 — 말 이동/지름길/잡기/업기, 게이지 기반 윷 던지기 판정, 턴 순환, 승리 판정까지. 클라이언트는 이번 계획에서는 placeholder(연결 상태만 표시)로 유지하고, 실제 화면(보드 렌더링, 게이지 UI, Matter.js 연출, 캐릭터/팀 선택 화면)은 별도 후속 계획에서 다룬다.

**Architecture:** songpyeon과 동일한 서버 권위형 패턴 — `server/src/game/` 아래 순수 함수(테스트 가능, 상태 없음)로 핵심 규칙을 구현하고, `server/src/rooms/MatchRoom.ts`가 Colyseus 메시지를 받아 이 순수 함수들을 호출해 `MatchState`(Colyseus Schema)를 갱신한다. 클라이언트는 입력만 보내고 state diff를 받아 그리는 구조(이번 계획에서는 그리는 부분이 아직 placeholder).

**Tech Stack:** Node + TypeScript + Colyseus(서버), vitest(테스트), @colyseus/testing(통합 테스트).

**Spec:** `yutnori/docs/REQUIREMENTS.md` (v0.2), `yutnori/docs/ARCHITECTURE.md` (v0.1)

## Global Constraints

- 서버 권위형: 말 위치, 턴 순서, 던지기 판정은 전부 서버가 계산하고 클라이언트가 보고하는 값은 신뢰하지 않는다 (REQUIREMENTS.md §5, ARCHITECTURE.md §2).
- 턴을 잡은 플레이어는 **자기 말 2개만** 이동 대상으로 선택 가능 (REQUIREMENTS.md §4).
- 팀 내 **한 명이라도** 자기 말 2개를 모두 완주시키면 그 팀 승리 (REQUIREMENTS.md §7).
- 윷/모가 나오면 같은 플레이어가 한 번 더 던진다 (REQUIREMENTS.md §4).
- 게이지 확률: 모 6.25%, 윷 6.25%, 걸 25%, 개 37.5%, 도 18.75%, 빽도 6.25% (REQUIREMENTS.md §5).
- 캐릭터 능력 효과는 이번 계획의 범위 밖 (REQUIREMENTS.md §2, §9) — 선택 자체(2종/중복 가능)만 구현.

### 설계 가정 — 보드 좌표계 (REQUIREMENTS.md에 없는 세부사항, 이번 계획에서 확정)

REQUIREMENTS.md §6은 "지름길: 보드 모서리에서 대각선 지름길로 진입 가능 (전통 규칙)"이라고만 되어 있고 정확한 좌표계는 없다. 아래는 표준 윷놀이판(외곽 20칸 + 중앙에서 교차하는 두 대각선) 구조를 바탕으로 이번 구현을 위해 확정한 모델이다 — **실제 게임과 다르면 Task 1 파일 하나만 고치면 되므로, 이후 사용자가 검토 후 수정 요청 가능**.

- 말의 위치는 4가지 종류: `start`(출발 전), `outer`(외곽 1~19번 칸), `center`(중앙), `finished`(완주).
- 외곽은 1~19번(20번=0번=출발/도착점은 `finished`로 표현하므로 별도 인덱스 없음). 지름길이 있는 모서리는 5, 10, 15번 칸.
- 말이 정확히 5/10/15번 칸에 있을 때, 다음 이동에서 "외곽 계속" 또는 "지름길(중앙 경유)" 중 선택 가능. 지름길 선택 시: 1칸 이동하면 `center`, 2칸 이상이면 바로 `finished`(중앙에서 어느 모서리를 거쳐 왔든 항상 집으로 가는 것이 항상 유리하므로, 이번 구현은 "중앙에서는 항상 집으로 직행"으로 단순화했다 — 지름길 진입 전 잠깐 중앙에 멈춰 설 수는 있지만, 중앙에 멈춘 뒤 다음 턴에는 몇 칸이 나오든 바로 완주로 처리).
- **빽도는 그래프 역주행이 아니라 "말의 직전 위치로 되돌리기"로 구현한다.** 분기점(모서리/중앙)에서는 "한 칸 뒤"가 그래프상 모호하므로(어느 갈래에서 왔는지에 따라 다름), 각 말이 자신의 직전 위치(`previousPosition`)를 들고 있다가 빽도가 나오면 그 값으로 되돌리는 방식을 쓴다. `start`에서 빽도는 아무 효과 없음(제자리).

---

### Task 1: 보드 위치 모델 (`position.ts`)

**Files:**
- Create: `server/src/game/position.ts`
- Test: `server/src/game/position.test.ts`

**Interfaces:**
- Produces:
  - `type Position = { kind: "start" } | { kind: "outer"; index: number } | { kind: "center" } | { kind: "finished" }`
  - `const SHORTCUT_JUNCTIONS: ReadonlySet<number>` (= `{5, 10, 15}`)
  - `function isAtShortcutJunction(pos: Position): boolean`
  - `function moveForward(from: Position, steps: number, useShortcut: boolean): Position` (`steps`는 1~5, 즉 도/개/걸/윷/모. `from.kind === "finished"`이면 에러)
  - `function moveBackward(from: Position, previousPosition: Position): Position` (빽도. `from.kind === "start"`이면 그대로 `{kind:"start"}` 반환)

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/game/position.test.ts
import { describe, expect, it } from "vitest";
import { moveBackward, moveForward, type Position } from "./position";

describe("moveForward", () => {
  it("출발 전 말이 도(1)를 던지면 외곽 1번 칸으로 이동한다", () => {
    const result = moveForward({ kind: "start" }, 1, false);
    expect(result).toEqual({ kind: "outer", index: 1 });
  });

  it("출발 전 말이 모(5)를 던지면 외곽 5번 칸(첫 지름길 모서리)에 도착한다", () => {
    const result = moveForward({ kind: "start" }, 5, false);
    expect(result).toEqual({ kind: "outer", index: 5 });
  });

  it("외곽 15번 칸에서 3칸 이동하면 외곽 18번 칸이다", () => {
    const result = moveForward({ kind: "outer", index: 15 }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 18 });
  });

  it("외곽 17번 칸에서 5칸 이동하면(17+5=22, 20 이상) 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 17 }, 5, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("정확히 20칸째(외곽 19+도 1칸)로 도착해도 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 19 }, 1, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("지름길 모서리(10번)에서 지름길을 안 쓰면 그냥 외곽으로 계속 간다", () => {
    const result = moveForward({ kind: "outer", index: 10 }, 2, false);
    expect(result).toEqual({ kind: "outer", index: 12 });
  });

  it("지름길 모서리(5번)에서 지름길로 1칸 이동하면 중앙에 도착한다", () => {
    const result = moveForward({ kind: "outer", index: 5 }, 1, true);
    expect(result).toEqual({ kind: "center" });
  });

  it("지름길 모서리(10번)에서 지름길로 2칸 이상 이동하면 바로 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 10 }, 2, true);
    expect(result).toEqual({ kind: "finished" });
  });

  it("중앙에서는 몇 칸을 던지든 항상 완주한다", () => {
    expect(moveForward({ kind: "center" }, 1, false)).toEqual({ kind: "finished" });
    expect(moveForward({ kind: "center" }, 5, true)).toEqual({ kind: "finished" });
  });

  it("완주한 말을 다시 이동시키려 하면 에러", () => {
    expect(() => moveForward({ kind: "finished" }, 1, false)).toThrow();
  });
});

describe("moveBackward", () => {
  it("빽도는 말을 직전 위치로 되돌린다", () => {
    const previous: Position = { kind: "outer", index: 4 };
    const result = moveBackward({ kind: "outer", index: 7 }, previous);
    expect(result).toEqual(previous);
  });

  it("출발 전 말에게 빽도는 아무 효과가 없다", () => {
    const result = moveBackward({ kind: "start" }, { kind: "start" });
    expect(result).toEqual({ kind: "start" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (server 워크스페이스 루트에서): `npm test -- position.test.ts`
Expected: FAIL — `Cannot find module './position'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/game/position.ts

export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "center" }
  | { kind: "finished" };

export const SHORTCUT_JUNCTIONS: ReadonlySet<number> = new Set([5, 10, 15]);

export function isAtShortcutJunction(pos: Position): boolean {
  return pos.kind === "center" || (pos.kind === "outer" && SHORTCUT_JUNCTIONS.has(pos.index));
}

const LAST_OUTER_INDEX = 19;

export function moveForward(from: Position, steps: number, useShortcut: boolean): Position {
  if (from.kind === "finished") {
    throw new Error("이미 완주한 말은 이동할 수 없습니다");
  }

  // 중앙에서는 항상 집으로 직행 (설계 가정 — 파일 상단 주석 참고)
  if (from.kind === "center") {
    return { kind: "finished" };
  }

  // 지름길 모서리에서 지름길을 선택한 경우
  if (from.kind === "outer" && useShortcut && SHORTCUT_JUNCTIONS.has(from.index)) {
    return steps === 1 ? { kind: "center" } : { kind: "finished" };
  }

  const startIndex = from.kind === "start" ? 0 : from.index;
  const nextIndex = startIndex + steps;

  if (nextIndex > LAST_OUTER_INDEX) {
    return { kind: "finished" };
  }
  return { kind: "outer", index: nextIndex };
}

export function moveBackward(from: Position, previousPosition: Position): Position {
  if (from.kind === "start") {
    return { kind: "start" };
  }
  return previousPosition;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- position.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/position.ts server/src/game/position.test.ts
git commit -m "보드 위치 모델(외곽/지름길/빽도) 구현"
```

---

### Task 2: 말 상태 + 잡기/업기 (`pieces.ts`)

**Files:**
- Create: `server/src/game/pieces.ts`
- Test: `server/src/game/pieces.test.ts`

**Interfaces:**
- Consumes: `Position`, `moveForward`, `moveBackward` (Task 1의 `position.ts`)
- Produces:
  - `type PieceId = string`
  - `interface Piece { id: PieceId; ownerId: string; position: Position; previousPosition: Position }`
  - `interface MoveResult { pieces: Piece[]; capturedPieceIds: PieceId[] }`
  - `function applyMove(pieces: Piece[], pieceId: PieceId, steps: number, useShortcut: boolean): MoveResult` (`steps`가 -1이면 빽도로 처리, 그 외 1~5는 전진. 이동한 말과 정확히 같은 위치에 있던 **자신의 다른 말**은 업어서 같이 이동. 이동한 말과 같은 위치에 있던 **상대 팀 말들**은 전부 `start`로 되돌리고 `capturedPieceIds`에 담아 반환)

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/game/pieces.test.ts
import { describe, expect, it } from "vitest";
import { applyMove, type Piece } from "./pieces";

function piece(id: string, ownerId: string, index: number): Piece {
  return {
    id,
    ownerId,
    position: { kind: "outer", index },
    previousPosition: { kind: "start" },
  };
}

describe("applyMove", () => {
  it("지정한 말을 steps만큼 전진시킨다", () => {
    const pieces = [piece("p1", "alice", 3)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    expect(result[0].position).toEqual({ kind: "outer", index: 5 });
  });

  it("이동 후 previousPosition을 이동 전 위치로 갱신한다", () => {
    const pieces = [piece("p1", "alice", 3)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    expect(result[0].previousPosition).toEqual({ kind: "outer", index: 3 });
  });

  it("steps가 -1(빽도)이면 직전 위치로 되돌린다", () => {
    const pieces: Piece[] = [
      { id: "p1", ownerId: "alice", position: { kind: "outer", index: 7 }, previousPosition: { kind: "outer", index: 4 } },
    ];
    const { pieces: result } = applyMove(pieces, "p1", -1, false);
    expect(result[0].position).toEqual({ kind: "outer", index: 4 });
  });

  it("이미 업혀 있던(같은 칸에 있던) 같은 주인의 말은 함께 이동한다", () => {
    // p1, p2가 이전 턴에 이미 같은 칸(5번)에서 업힌 상태로 시작
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false); // p1: 5->7
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 7 });
    expect(p2.position).toEqual({ kind: "outer", index: 7 }); // 같이 이동
  });

  it("함께 이동한 말도 previousPosition이 이동 전 위치로 갱신된다", () => {
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p2.previousPosition).toEqual({ kind: "outer", index: 5 });
  });

  it("도착 칸에 이미 있던 같은 주인의 말은 업히기만 하고(제자리), 잡히지 않는다", () => {
    // p2는 도착 칸(5번)에 미리 있었을 뿐 p1과 함께 출발한 게 아니므로 이동하지 않는다 —
    // 이 시점부터 둘은 같은 칸에 있게 되어 "업힌" 상태가 되고, 다음 이동부터 함께 움직인다.
    const pieces = [piece("p1", "alice", 3), piece("p2", "alice", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false); // p1: 3->5
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 5 });
    expect(p2.position).toEqual({ kind: "outer", index: 5 }); // 원래 있던 자리 그대로
    expect(capturedPieceIds).toEqual([]); // 자기 말은 잡히지 않음
  });

  it("도착 칸에 상대 말이 있으면 시작점으로 돌려보내고 capturedPieceIds에 담는다", () => {
    const pieces = [piece("p1", "alice", 3), piece("enemy1", "bob", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });

  it("도착 칸에 내 말과 상대 말이 섞여 있으면 내 말은 그대로, 상대 말만 잡힌다", () => {
    const pieces = [piece("p1", "alice", 3), piece("p2", "alice", 5), piece("enemy1", "bob", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const p2 = result.find((p) => p.id === "p2")!;
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(p2.position).toEqual({ kind: "outer", index: 5 }); // 제자리(업힘)
    expect(enemy.position).toEqual({ kind: "start" }); // 잡힘
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- pieces.test.ts`
Expected: FAIL — `Cannot find module './pieces'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/game/pieces.ts
import { moveBackward, moveForward, type Position } from "./position";

export type PieceId = string;

export interface Piece {
  id: PieceId;
  ownerId: string;
  position: Position;
  previousPosition: Position;
}

export interface MoveResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
}

function samePosition(a: Position, b: Position): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  return true;
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

  // 도착 칸에 있던 상대 말 (잡기 대상) — 새 위치가 outer일 때만 의미 있음
  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.ownerId !== mover.ownerId && samePosition(p.position, newPosition) && newPosition.kind !== "start" && newPosition.kind !== "finished")
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

  return { pieces: result, capturedPieceIds };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- pieces.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/pieces.ts server/src/game/pieces.test.ts
git commit -m "말 이동/업기/잡기 로직 구현"
```

---

### Task 3: 게이지 던지기 판정 (`gauge.ts`)

**Files:**
- Create: `server/src/game/gauge.ts`
- Test: `server/src/game/gauge.test.ts`

**Interfaces:**
- Produces:
  - `type YutResult = "backDo" | "do" | "gae" | "geol" | "yut" | "mo"`
  - `const YUT_STEPS: Record<YutResult, number>` (`backDo: -1, do: 1, gae: 2, geol: 3, yut: 4, mo: 5`)
  - `const GRANTS_EXTRA_THROW: ReadonlySet<YutResult>` (`{"yut", "mo"}`)
  - `const DEFAULT_GAUGE_CYCLE_MS = 1500`
  - `function wavePosition(elapsedMs: number, cycleMs: number): number` (0~1 삼각파, 0→1→0)
  - `function resolveThrow(startAtMs: number, releaseAtMs: number, cycleMs?: number): YutResult` (서버가 자체 시계로 재계산하는 판정 함수 — `releaseAtMs - startAtMs`를 `wavePosition`에 넣고 6구간 표에서 결과 조회)

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/game/gauge.test.ts
import { describe, expect, it } from "vitest";
import { resolveThrow, wavePosition } from "./gauge";

describe("wavePosition", () => {
  it("주기의 절반 지점에서 최대값(1)에 가깝다", () => {
    expect(wavePosition(750, 1500)).toBeCloseTo(1, 5);
  });

  it("주기 시작점은 0이다", () => {
    expect(wavePosition(0, 1500)).toBeCloseTo(0, 5);
  });

  it("주기를 넘어가면 다시 반복된다 (왕복 파형)", () => {
    expect(wavePosition(1500, 1500)).toBeCloseTo(0, 5);
    expect(wavePosition(2250, 1500)).toBeCloseTo(1, 5);
  });
});

describe("resolveThrow", () => {
  // 경계: [0,.0625)모 [.0625,.125)윷 [.125,.375)걸 [.375,.75)개 [.75,.8125)빽도 [.8125,1.0)도
  // wavePosition은 0->1로 선형 증가하는 구간(전반부, elapsed < cycleMs/2)만 사용해 경계 계산을 쉽게 한다.
  const cycleMs = 1500; // 전반부(0~750ms)가 0~1 선형 구간

  it("파형 0.03 지점(모 구간)이면 모가 나온다", () => {
    const elapsed = 0.03 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("mo");
  });

  it("파형 0.10 지점(윷 구간)이면 윷이 나온다", () => {
    const elapsed = 0.1 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("yut");
  });

  it("파형 0.25 지점(걸 구간)이면 걸이 나온다", () => {
    const elapsed = 0.25 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("geol");
  });

  it("파형 0.5 지점(개 구간)이면 개가 나온다", () => {
    const elapsed = 0.5 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("gae");
  });

  it("파형 0.78 지점(빽도 구간)이면 빽도가 나온다", () => {
    const elapsed = 0.78 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("backDo");
  });

  it("파형 0.9 지점(도 구간)이면 도가 나온다", () => {
    const elapsed = 0.9 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("do");
  });

  it("startAtMs와 releaseAtMs의 차이만 판정에 사용한다 (절대 시각 무관)", () => {
    const a = resolveThrow(10_000, 10_000 + 0.03 * (cycleMs / 2), cycleMs);
    const b = resolveThrow(0, 0.03 * (cycleMs / 2), cycleMs);
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- gauge.test.ts`
Expected: FAIL — `Cannot find module './gauge'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/game/gauge.ts

export type YutResult = "backDo" | "do" | "gae" | "geol" | "yut" | "mo";

export const YUT_STEPS: Record<YutResult, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};

export const GRANTS_EXTRA_THROW: ReadonlySet<YutResult> = new Set(["yut", "mo"]);

export const DEFAULT_GAUGE_CYCLE_MS = 1500;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. */
export function wavePosition(elapsedMs: number, cycleMs: number): number {
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// REQUIREMENTS.md §5: 모 6.25% / 윷 6.25% / 걸 25% / 개 37.5% / 빽도 6.25% / 도 18.75%
// (빽도는 "도 구간 안의 하위 구간"으로 문서화되어 있으나, 확률적으로는 6구간 평면 조회와 동일하므로
//  단일 조회 테이블로 구현한다 — ARCHITECTURE.md §3 참고)
const ZONES: Array<{ upperBound: number; result: YutResult }> = [
  { upperBound: 0.0625, result: "mo" },
  { upperBound: 0.125, result: "yut" },
  { upperBound: 0.375, result: "geol" },
  { upperBound: 0.75, result: "gae" },
  { upperBound: 0.8125, result: "backDo" },
  { upperBound: 1.0, result: "do" },
];

export function resolveThrow(startAtMs: number, releaseAtMs: number, cycleMs: number = DEFAULT_GAUGE_CYCLE_MS): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound);
  return (zone ?? ZONES[ZONES.length - 1]).result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- gauge.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/gauge.ts server/src/game/gauge.test.ts
git commit -m "게이지 파형 및 윷 던지기 서버 판정 구현"
```

---

### Task 4: 턴 순서 + 승리 판정 (`turns.ts`)

**Files:**
- Create: `server/src/game/turns.ts`
- Test: `server/src/game/turns.test.ts`

**Interfaces:**
- Consumes: `Piece` (Task 2의 `pieces.ts`), `YutResult`, `GRANTS_EXTRA_THROW` (Task 3의 `gauge.ts`)
- Produces:
  - `function buildTurnOrder(teamAIds: [string, string], teamBIds: [string, string]): string[]` (REQUIREMENTS.md §4: A팀원1→B팀원1→A팀원2→B팀원2 순서로 교차)
  - `function nextTurnIndex(currentIndex: number, order: string[], result: YutResult): number` (윷/모면 그대로, 아니면 다음 사람)
  - `function checkWinner(pieces: Piece[], ownerId: string): boolean` (해당 owner의 말이 정확히 2개이고 전부 `finished`면 true)

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/game/turns.test.ts
import { describe, expect, it } from "vitest";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "./turns";
import type { Piece } from "./pieces";

describe("buildTurnOrder", () => {
  it("A팀원1 -> B팀원1 -> A팀원2 -> B팀원2 순서로 교차한다", () => {
    const order = buildTurnOrder(["a1", "a2"], ["b1", "b2"]);
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });
});

describe("nextTurnIndex", () => {
  const order = ["a1", "b1", "a2", "b2"];

  it("윷/모가 아니면 다음 사람으로 넘어간다", () => {
    expect(nextTurnIndex(0, order, "gae")).toBe(1);
  });

  it("순환 순서 끝에서는 처음으로 돌아온다", () => {
    expect(nextTurnIndex(3, order, "do")).toBe(0);
  });

  it("윷이 나오면 같은 사람 차례가 유지된다", () => {
    expect(nextTurnIndex(1, order, "yut")).toBe(1);
  });

  it("모가 나오면 같은 사람 차례가 유지된다", () => {
    expect(nextTurnIndex(2, order, "mo")).toBe(2);
  });
});

describe("checkWinner", () => {
  function finishedPiece(id: string, ownerId: string): Piece {
    return { id, ownerId, position: { kind: "finished" }, previousPosition: { kind: "start" } };
  }
  function unfinishedPiece(id: string, ownerId: string): Piece {
    return { id, ownerId, position: { kind: "outer", index: 3 }, previousPosition: { kind: "start" } };
  }

  it("자기 말 2개가 모두 완주하면 승리", () => {
    const pieces = [finishedPiece("p1", "alice"), finishedPiece("p2", "alice")];
    expect(checkWinner(pieces, "alice")).toBe(true);
  });

  it("말 1개만 완주하면 아직 승리 아님", () => {
    const pieces = [finishedPiece("p1", "alice"), unfinishedPiece("p2", "alice")];
    expect(checkWinner(pieces, "alice")).toBe(false);
  });

  it("다른 사람 말이 완주해도 이 owner의 승리로 치지 않는다", () => {
    const pieces = [finishedPiece("p1", "bob"), finishedPiece("p2", "bob")];
    expect(checkWinner(pieces, "alice")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- turns.test.ts`
Expected: FAIL — `Cannot find module './turns'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/game/turns.ts
import { GRANTS_EXTRA_THROW, type YutResult } from "./gauge";
import type { Piece } from "./pieces";

export function buildTurnOrder(teamAIds: [string, string], teamBIds: [string, string]): string[] {
  return [teamAIds[0], teamBIds[0], teamAIds[1], teamBIds[1]];
}

export function nextTurnIndex(currentIndex: number, order: string[], result: YutResult): number {
  if (GRANTS_EXTRA_THROW.has(result)) {
    return currentIndex;
  }
  return (currentIndex + 1) % order.length;
}

export function checkWinner(pieces: Piece[], ownerId: string): boolean {
  const ownPieces = pieces.filter((p) => p.ownerId === ownerId);
  return ownPieces.length === 2 && ownPieces.every((p) => p.position.kind === "finished");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- turns.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/turns.ts server/src/game/turns.test.ts
git commit -m "턴 순서 순환 및 승리 판정 구현"
```

---

### Task 5: Colyseus 상태 스키마 (`MatchState.ts`)

**Files:**
- Modify: `server/src/rooms/MatchState.ts` (기존 placeholder를 실제 스키마로 교체)
- Test: `server/src/rooms/MatchState.test.ts`

**Interfaces:**
- Consumes: 없음 (Colyseus `Schema` 데코레이터만 사용)
- Produces:
  - `class PlayerState extends Schema` — `sessionId: string, team: string("A"|"B"|""), ready: boolean, characters: ArraySchema<string>`(0~2개)
  - `class PieceSchema extends Schema` — `id: string, ownerSessionId: string, positionKind: string, positionIndex: number, previousPositionKind: string, previousPositionIndex: number`
  - `class MatchState extends Schema` — `phase: string("waiting"|"playing"|"finished"), players: MapSchema<PlayerState>, pieces: ArraySchema<PieceSchema>, turnOrder: ArraySchema<string>, currentTurnIndex: number, gaugePhase: string("idle"|"charging"), throwStartAt: number, winnerSessionId: string`

**참고:** `PieceSchema`가 `position: Position`(유니온 타입)을 그대로 못 담으므로 `positionKind`/`positionIndex`로 펼쳐서 저장한다(`index`는 `outer`가 아닐 때 `-1`). `server/src/game/position.ts`의 `Position`과 이 스키마 사이를 변환하는 헬퍼(`toSchemaPosition`/`fromSchemaPosition`)도 같은 파일에 둔다.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/rooms/MatchState.test.ts
import { describe, expect, it } from "vitest";
import { fromSchemaPosition, MatchState, PieceSchema, PlayerState, toSchemaPosition } from "./MatchState";

describe("MatchState 스키마", () => {
  it("초기 상태는 waiting phase, 빈 players/pieces를 가진다", () => {
    const state = new MatchState();
    expect(state.phase).toBe("waiting");
    expect(state.players.size).toBe(0);
    expect(state.pieces.length).toBe(0);
  });

  it("PlayerState를 players 맵에 추가할 수 있다", () => {
    const state = new MatchState();
    const player = new PlayerState();
    player.sessionId = "s1";
    state.players.set("s1", player);
    expect(state.players.get("s1")?.sessionId).toBe("s1");
  });
});

describe("Position <-> Schema 변환", () => {
  it("outer 위치를 왕복 변환해도 값이 보존된다", () => {
    const schema = toSchemaPosition({ kind: "outer", index: 7 });
    expect(schema).toEqual({ kind: "outer", index: 7 });
    expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind: "outer", index: 7 });
  });

  it("start/center/finished는 index -1로 저장되고 복원된다", () => {
    for (const kind of ["start", "center", "finished"] as const) {
      const schema = toSchemaPosition({ kind });
      expect(schema.index).toBe(-1);
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MatchState.test.ts`
Expected: FAIL — 기존 `MatchState`에 `players`/`pieces`/`PlayerState`/`PieceSchema`/변환 함수가 없음

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/rooms/MatchState.ts
import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { Position } from "../game/position";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") team: string = ""; // "A" | "B" | ""
  @type("boolean") ready: boolean = false;
  @type(["string"]) characters = new ArraySchema<string>();
}

export class PieceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerSessionId: string = "";
  @type("string") positionKind: string = "start"; // "start" | "outer" | "center" | "finished"
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
}

export class MatchState extends Schema {
  @type("string") phase: string = "waiting"; // "waiting" | "playing" | "finished"
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([PieceSchema]) pieces = new ArraySchema<PieceSchema>();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("number") currentTurnIndex: number = 0;
  @type("string") gaugePhase: string = "idle"; // "idle" | "charging"
  @type("number") throwStartAt: number = 0;
  @type("string") winnerSessionId: string = "";
}

export function toSchemaPosition(pos: Position): { kind: string; index: number } {
  if (pos.kind === "outer") {
    return { kind: "outer", index: pos.index };
  }
  return { kind: pos.kind, index: -1 };
}

export function fromSchemaPosition(kind: string, index: number): Position {
  if (kind === "outer") {
    return { kind: "outer", index };
  }
  return { kind: kind as "start" | "center" | "finished" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MatchState.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchState.test.ts
git commit -m "MatchState를 실제 게임 스키마로 교체 (플레이어/말/턴/게이지)"
```

---

### Task 6: MatchRoom 배선 (대기실 + 던지기 + 이동 + 승리)

**Files:**
- Modify: `server/src/rooms/MatchRoom.ts` (기존 placeholder를 실제 로직으로 교체)
- Test: `server/src/rooms/MatchRoom.test.ts`

**Interfaces:**
- Consumes: `buildTurnOrder`, `nextTurnIndex`, `checkWinner` (Task 4 `turns.ts`), `resolveThrow`, `YUT_STEPS` (Task 3 `gauge.ts`), `applyMove` (Task 2 `pieces.ts`), `toSchemaPosition`/`fromSchemaPosition`/`MatchState`/`PlayerState`/`PieceSchema` (Task 5 `MatchState.ts`)
- Produces (클라이언트가 보내는 메시지, 이후 클라이언트 계획에서 그대로 재사용):
  - `"pickTeam"`: `{ team: "A" | "B" }`
  - `"pickCharacters"`: `{ characters: string[] }` (정확히 2개, `["교주","성직","마담","의사"]` 중에서만 허용)
  - `"ready"`: `{}` (토글)
  - `"throwStart"`: `{}`
  - `"throwRelease"`: `{}`
  - `"movePiece"`: `{ pieceId: string; useShortcut?: boolean }`

**게임 시작 조건:** 4명 모두 `ready === true`이고, team이 A 2명/B 2명으로 정확히 나뉘어 있고, 각자 `characters.length === 2`일 때. 시작 시 `buildTurnOrder`로 턴 순서를 정하고(팀 내에서는 join한 순서가 팀원1/팀원2), 8개 말(`{kind:"start"}`)을 생성한다.

**타이밍 관련 주의:** 게이지 판정(`throwStartAt`/`resolveThrow`)에는 `this.clock.currentTime`(Colyseus의 내부 시뮬레이션 클록)이 아니라 **`Date.now()`를 직접 써야 한다.** `this.clock`은 `setSimulationInterval`을 쓰지 않는 이번 방(room)에서는 `broadcastPatch()`가 호출될 때만(기본 patchRate=50ms) 갱신되므로, "모" 구간처럼 46.875ms보다 좁은 구간을 판정하기엔 해상도가 너무 거칠다. `Date.now()`는 이 문제가 없다.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/rooms/MatchRoom.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";
import { DEFAULT_GAUGE_CYCLE_MS } from "../game/gauge";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

async function setupFourPlayers(colyseus: ColyseusTestServer) {
  const room = await colyseus.createRoom("match", {});
  const clients = await Promise.all([
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
    colyseus.connectTo(room),
  ]);

  const teams = ["A", "A", "B", "B"];
  for (let i = 0; i < 4; i++) {
    clients[i].send("pickTeam", { team: teams[i] });
    clients[i].send("pickCharacters", { characters: [CHARACTERS[0], CHARACTERS[1]] });
  }
  await flush();
  for (const client of clients) {
    client.send("ready", {});
  }
  await flush();

  return { room, clients };
}

function flush(ms = 50) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MatchRoom", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  it("4명이 팀/캐릭터를 정하고 준비하면 게임이 시작된다", async () => {
    const { room } = await setupFourPlayers(colyseus);
    expect(room.state.phase).toBe("playing");
    expect(room.state.pieces.length).toBe(8);
    expect(room.state.turnOrder.length).toBe(4);
  });

  it("현재 턴 플레이어가 아니면 throwStart가 무시된다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const notTurnClient = clients.find((c) => c.sessionId !== currentTurnSessionId)!;

    notTurnClient.send("throwStart", {});
    await flush();

    expect(room.state.gaugePhase).toBe("idle");
  });

  it("현재 턴 플레이어가 throwStart -> throwRelease -> movePiece를 하면 말이 이동한다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const myPiece = room.state.pieces.find((p) => p.ownerSessionId === currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    expect(room.state.gaugePhase).toBe("charging");

    // wavePosition(0.03 * cycle/2) 근방 -> "mo"(5칸) 구간을 노리고 아주 짧게 대기 후 release
    await flush(0.03 * (DEFAULT_GAUGE_CYCLE_MS / 2));
    turnClient.send("throwRelease", {});
    await flush();

    turnClient.send("movePiece", { pieceId: myPiece.id });
    await flush();

    const movedPiece = room.state.pieces.find((p) => p.id === myPiece.id)!;
    expect(movedPiece.positionKind).toBe("outer");
    expect(movedPiece.positionIndex).toBeGreaterThan(0);
  });

  it("자기 말이 아닌 말은 이동시킬 수 없다", async () => {
    const { room, clients } = await setupFourPlayers(colyseus);
    const currentTurnSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    const turnClient = clients.find((c) => c.sessionId === currentTurnSessionId)!;
    const otherPiece = room.state.pieces.find((p) => p.ownerSessionId !== currentTurnSessionId)!;

    turnClient.send("throwStart", {});
    await flush();
    turnClient.send("throwRelease", {});
    await flush();
    turnClient.send("movePiece", { pieceId: otherPiece.id });
    await flush();

    const untouchedPiece = room.state.pieces.find((p) => p.id === otherPiece.id)!;
    expect(untouchedPiece.positionKind).toBe("start"); // 이동 안 됨
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- MatchRoom.test.ts`
Expected: FAIL — `MatchRoom`이 아직 `pickTeam`/`pickCharacters`/`ready`/`throwStart`/`throwRelease`/`movePiece` 메시지를 처리하지 않음

- [ ] **Step 3: Write minimal implementation**

```typescript
// server/src/rooms/MatchRoom.ts
import { Room, Client } from "colyseus";
import { applyMove, type Piece } from "../game/pieces";
import { resolveThrow, YUT_STEPS, type YutResult } from "../game/gauge";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "../game/turns";
import { MatchState, PieceSchema, PlayerState, fromSchemaPosition, toSchemaPosition } from "./MatchState";

const VALID_CHARACTERS = new Set(["교주", "성직", "마담", "의사"]);

export class MatchRoom extends Room<MatchState> {
  maxClients = 4;
  private pendingThrows = new Map<string, YutResult>();

  onCreate() {
    this.setState(new MatchState());

    this.onMessage("pickTeam", (client, message: { team: "A" | "B" }) => {
      if (this.state.phase !== "waiting") return;
      if (message.team !== "A" && message.team !== "B") return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.team = message.team;
    });

    this.onMessage("pickCharacters", (client, message: { characters: string[] }) => {
      if (this.state.phase !== "waiting") return;
      if (message.characters.length !== 2 || !message.characters.every((c) => VALID_CHARACTERS.has(c))) return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.characters.clear();
      for (const c of message.characters) player.characters.push(c);
    });

    this.onMessage("ready", (client) => {
      if (this.state.phase !== "waiting") return;
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = !player.ready;
      this.maybeStartGame();
    });

    this.onMessage("throwStart", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "idle") return;
      this.state.gaugePhase = "charging";
      this.state.throwStartAt = Date.now();
    });

    this.onMessage("throwRelease", (client) => {
      if (!this.isCurrentTurn(client.sessionId) || this.state.gaugePhase !== "charging") return;
      const result = resolveThrow(this.state.throwStartAt, Date.now());
      this.pendingThrows.set(client.sessionId, result);
      this.state.gaugePhase = "idle";
    });

    this.onMessage("movePiece", (client, message: { pieceId: string; useShortcut?: boolean }) => {
      this.handleMovePiece(client, message);
    });
  }

  onJoin(client: Client) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
  }

  private isCurrentTurn(sessionId: string): boolean {
    return this.state.phase === "playing" && this.state.turnOrder[this.state.currentTurnIndex] === sessionId;
  }

  private maybeStartGame() {
    if (this.state.players.size !== 4) return;
    const allPlayers = Array.from(this.state.players.values());
    if (!allPlayers.every((p) => p.ready && p.characters.length === 2)) return;

    const teamA = allPlayers.filter((p) => p.team === "A").map((p) => p.sessionId);
    const teamB = allPlayers.filter((p) => p.team === "B").map((p) => p.sessionId);
    if (teamA.length !== 2 || teamB.length !== 2) return;

    const order = buildTurnOrder([teamA[0], teamA[1]], [teamB[0], teamB[1]]);
    this.state.turnOrder.clear();
    for (const id of order) this.state.turnOrder.push(id);
    this.state.currentTurnIndex = 0;

    this.state.pieces.clear();
    for (const sessionId of [...teamA, ...teamB]) {
      for (let i = 0; i < 2; i++) {
        const piece = new PieceSchema();
        piece.id = `${sessionId}-${i}`;
        piece.ownerSessionId = sessionId;
        piece.positionKind = "start";
        piece.positionIndex = -1;
        piece.previousPositionKind = "start";
        piece.previousPositionIndex = -1;
        this.state.pieces.push(piece);
      }
    }

    this.state.phase = "playing";
  }

  private handleMovePiece(client: Client, message: { pieceId: string; useShortcut?: boolean }) {
    if (!this.isCurrentTurn(client.sessionId)) return;
    const result = this.pendingThrows.get(client.sessionId);
    if (!result) return;

    const targetPiece = this.state.pieces.find((p) => p.id === message.pieceId);
    if (!targetPiece || targetPiece.ownerSessionId !== client.sessionId) return;

    const pieces: Piece[] = this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));

    const { pieces: updated } = applyMove(pieces, message.pieceId, YUT_STEPS[result], message.useShortcut ?? false);

    for (const updatedPiece of updated) {
      const schemaPiece = this.state.pieces.find((p) => p.id === updatedPiece.id)!;
      const pos = toSchemaPosition(updatedPiece.position);
      const prevPos = toSchemaPosition(updatedPiece.previousPosition);
      schemaPiece.positionKind = pos.kind;
      schemaPiece.positionIndex = pos.index;
      schemaPiece.previousPositionKind = prevPos.kind;
      schemaPiece.previousPositionIndex = prevPos.index;
    }

    this.pendingThrows.delete(client.sessionId);

    const finalPieces: Piece[] = this.state.pieces.map((p) => ({
      id: p.id,
      ownerId: p.ownerSessionId,
      position: fromSchemaPosition(p.positionKind, p.positionIndex),
      previousPosition: fromSchemaPosition(p.previousPositionKind, p.previousPositionIndex),
    }));

    if (checkWinner(finalPieces, client.sessionId)) {
      this.state.phase = "finished";
      this.state.winnerSessionId = client.sessionId;
      return;
    }

    this.state.currentTurnIndex = nextTurnIndex(
      this.state.currentTurnIndex,
      Array.from(this.state.turnOrder),
      result,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- MatchRoom.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchRoom.ts server/src/rooms/MatchRoom.test.ts
git commit -m "MatchRoom에 대기실/던지기/이동/승리 로직 배선"
```

---

### Task 7: 전체 매치 종단간 통합 테스트

**Files:**
- Test: `server/src/rooms/MatchRoom.fullGame.test.ts`

**Interfaces:**
- Consumes: Task 1~6에서 만든 모든 것. 새로 생성하는 함수/타입 없음 — 지금까지의 배선이 실제로 승리까지 이어지는지 확인하는 검증용 테스트.

- [ ] **Step 1: Write the failing test**

```typescript
// server/src/rooms/MatchRoom.fullGame.test.ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createGameServer } from "../createServer";

const CHARACTERS = ["교주", "성직", "마담", "의사"];

function flush(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("MatchRoom 전체 매치 흐름", () => {
  let colyseus: ColyseusTestServer;

  beforeAll(async () => {
    colyseus = await boot(createGameServer());
  });
  afterAll(async () => await colyseus.shutdown());
  afterEach(async () => await colyseus.cleanup());

  it("한 플레이어의 말 2개가 모두 완주할 때까지 반복해서 던지고 이동하면 그 팀이 승리한다", async () => {
    const room = await colyseus.createRoom("match", {});
    const clients = await Promise.all([
      colyseus.connectTo(room),
      colyseus.connectTo(room),
      colyseus.connectTo(room),
      colyseus.connectTo(room),
    ]);

    const teams = ["A", "A", "B", "B"];
    for (let i = 0; i < 4; i++) {
      clients[i].send("pickTeam", { team: teams[i] });
      clients[i].send("pickCharacters", { characters: [CHARACTERS[0], CHARACTERS[1]] });
    }
    await flush();
    for (const client of clients) client.send("ready", {});
    await flush();

    expect(room.state.phase).toBe("playing");

    // 승리 조건: 한 플레이어(turnOrder[0])의 말 2개가 완주할 때까지,
    // 그 사람 턴이 돌아올 때마다 "모(5칸)" 구간을 노려서 최대한 빨리 진행시킨다.
    // wavePosition(x)=x for x in [0, 0.5]인 전반부를 이용해 mo 구간(상한 0.0625) 초반을 노린다.
    const targetSessionId = room.state.turnOrder[0];
    const targetClient = clients.find((c) => c.sessionId === targetSessionId)!;

    for (let guard = 0; guard < 60; guard++) {
      if (room.state.phase === "finished") break;

      const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
      const currentClient = clients.find((c) => c.sessionId === currentSessionId)!;

      currentClient.send("throwStart", {});
      await flush(5); // wavePosition 전반부 초입 근처 -> "모" 구간 노림
      currentClient.send("throwRelease", {});
      await flush();

      const myUnfinished = room.state.pieces.find(
        (p) => p.ownerSessionId === currentSessionId && p.positionKind !== "finished",
      );
      if (myUnfinished) {
        currentClient.send("movePiece", { pieceId: myUnfinished.id });
        await flush();
      }
    }

    expect(room.state.phase).toBe("finished");
    expect(room.state.winnerSessionId).not.toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npm test -- MatchRoom.fullGame.test.ts`

이 테스트는 새 코드를 추가하지 않으므로 "실패 확인" 단계가 없다 — 바로 실행해서 결과를 확인한다.
Expected (처음 실행 시): 게이지 타이밍이 안 맞아 "모"가 아닌 다른 결과가 나오면서 60회 반복 안에 못 끝날 수 있음 — 이 경우 Step 3에서 타이밍을 조정한다.

- [ ] **Step 3: 필요 시 타이밍 조정 후 재실행**

`flush(5)`의 5ms가 실제 `DEFAULT_GAUGE_CYCLE_MS=1500`ms 기준 `wavePosition`의 "모" 구간(상한 0.0625, 즉 실제 경과시간 약 0~46.875ms)에 안정적으로 들어가는지 확인한다. `Date.now()` 기반이라 실제 경과시간과 오차가 거의 없어야 하지만, 이벤트 루프 지연 등으로 46.875ms를 넘기면 다른 결과가 나올 수 있으므로, 필요하면 `flush(5)`를 더 낮추거나(예: `flush(2)`) 여전히 46.875ms 미만을 유지하는 선에서 조정한다. (songpyeon의 `waitForNextPatch()` 관련 gotcha와 마찬가지로, 이런 실시간 타이머 테스트는 고정 지연보다 상태를 직접 읽어 확인하는 편이 안전하다 — 60회 반복 가드가 바로 그 안전장치다.)

Run: `npm test -- MatchRoom.fullGame.test.ts`
Expected: PASS

- [ ] **Step 4: 전체 서버 테스트 스위트 실행**

Run: `npm test --workspace server`
Expected: 모든 테스트(Task 1~7) PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/rooms/MatchRoom.fullGame.test.ts
git commit -m "전체 매치 종단간(join~승리) 통합 테스트 추가"
```

---

## Self-Review 메모

- **Spec coverage:** REQUIREMENTS.md §1(구조)/§2(캐릭터 선택, 능력 제외)/§4(턴/자기 말만 이동)/§5(게이지 확률)/§6(이동 규칙, 보드 좌표계는 이번 계획에서 확정)/§7(승리 조건)까지 Task 1~7이 커버한다. §3(로비/팀 배정 UI)과 §8(채팅 말풍선)은 클라이언트 화면이 필요해 후속 계획으로 분리했다 — `pickTeam`/`pickCharacters` 메시지 자체는 이번 계획에 포함되어 있으므로 후속 계획은 이 메시지를 호출하는 화면만 만들면 된다.
- **Placeholder scan:** 모든 스텝에 실제 코드/테스트가 포함되어 있고 "TODO" 등은 없음.
- **Type consistency:** `Position`(Task1) → `Piece.position`(Task2) → `MatchState` 변환 헬퍼(Task5) → `MatchRoom`(Task6)까지 타입 이름과 필드명을 동일하게 유지했다 (`kind`/`index`, `positionKind`/`positionIndex` 명명 일관).
