# 지름길(대각선) 위치 모델 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버의 지름길 위치 모델을 "모서리에서 지름길 타면 즉시 중앙/완주"라는 단순화에서, 실제 윷판처럼 대각선 중간칸을 실제로 거쳐가는 정확한 모델로 재설계한다.

**Architecture:** `Position` 타입에 `shortcutIn`(모서리→중앙 구간)과 `shortcutOut`(중앙→도착 구간) 두 종류를 추가하고, 전체 지름길 경로를 "모서리를 절대값 0으로 하는 6칸 트랙"으로 계산하는 단일 헬퍼로 이동 로직을 통일한다. 그 위에 얹힌 잡기/업기(`pieces.ts`)와 서버 상태 인코딩(`MatchState.ts`)만 새 kind를 인식하도록 확장하고, 능력 시스템(`abilities.ts`)과 클라이언트 렌더링 로직은 건드리지 않는다(스펙 §7).

**Tech Stack:** Node + TypeScript(서버, TDD via vitest), React + TypeScript(클라이언트, 타입만 갱신).

**Spec:** `docs/superpowers/specs/2026-08-22-diagonal-shortcut-model-design.md`

## Global Constraints

- 지름길 전체 경로는 "모서리=절대값 0, shortcutIn 1~2, center=3, shortcutOut 4~5, finished=6 이상"인 하나의 6칸 트랙으로 계산한다(스펙 §4). 모든 이동 계산은 이 절대값 변환을 거친다.
- 중앙을 지난 뒤에는 선택지 없이 항상 도착 방향으로만 자동 진행한다 — `useShortcut` 인자는 `shortcutIn`/`center`/`shortcutOut`에서 이동할 때 의미가 없다(무시한다).
- 출발점 모서리(20번째/0번째 자리)에는 지름길 진입점을 추가하지 않는다 — 기존 `SHORTCUT_JUNCTIONS = {5, 10, 15}` 그대로 유지.
- `shortcutIn`은 `junction`(5|10|15)과 `step`(1|2)을 갖고, 서로 다른 junction은 같은 step이어도 다른 칸으로 취급한다. `shortcutOut`은 `step`(1|2)만 갖는다(중앙을 지나면 경로가 합쳐지므로 junction 불필요).
- 서버 상태 인코딩은 새 스키마 필드를 추가하지 않고 기존 `positionKind: string` / `positionIndex: number` 2필드 방식을 재사용한다 — `shortcutIn`은 `positionKind`를 `"shortcutIn5"`/`"shortcutIn10"`/`"shortcutIn15"`로, `positionIndex`에 step을 저장. `shortcutOut`은 `positionKind: "shortcutOut"`, `positionIndex`에 step.
- `abilities.ts`(능력 시스템)는 이 플랜에서 수정하지 않는다 — `sideOf`가 `outer` 이외 모든 kind에 `null`을 반환하는 기존 동작이 새 kind에도 자동으로 적용된다.
- 클라이언트의 실제 보드 시각화(지름길 칸을 화면에 정확한 좌표로 그리는 것)는 이 플랜의 범위 밖이다 — 후속 스펙에서 다룬다. 이 플랜은 클라이언트 타입 정합성만 맞춘다.
- 서버 순수 게임 로직은 TDD로 작성한다.
- 커밋 메시지는 한국어로, `feat:`/`fix:` 같은 프리픽스 없이 작성한다.

---

## File Structure

- `server/src/game/position.ts` (수정): `Position` 타입에 `shortcutIn`/`shortcutOut` 추가, `moveForward`를 절대값 기반으로 재작성, `isAtShortcutJunction` 의미 정정.
- `server/src/game/pieces.ts` (수정): `samePosition`이 새 kind를 인식하도록 확장.
- `server/src/rooms/MatchState.ts` (수정): `toSchemaPosition`/`fromSchemaPosition`이 새 kind를 왕복 변환하도록 확장.
- `client/src/game/matchTypes.ts` (수정): `PositionKind` 타입에 새 kind 문자열 추가(타입 정합성만, 렌더링 로직 변경 없음).

---

### Task 1: 위치 모델 & 이동 로직 재작성 — `position.ts`

**Files:**
- Modify: `server/src/game/position.ts`
- Test: `server/src/game/position.test.ts`

**Interfaces:**
- Produces: 확장된 `Position` 유니언 타입(`shortcutIn { junction: 5|10|15; step: 1|2 }`, `shortcutOut { step: 1|2 }` 추가). `moveForward(from: Position, steps: number, useShortcut: boolean): Position`(시그니처 동일, 동작만 변경). `moveBackward`(변경 없음). `sideOf`/`sameSide`(변경 없음, 새 kind에 대해서도 기존 로직이 자연히 `null`/`false` 반환).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/game/position.test.ts` 파일 전체를 아래로 교체한다:

```ts
import { describe, expect, it } from "vitest";
import { moveBackward, moveForward, sameSide, sideOf, type Position } from "./position";

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

  it("완주한 말을 다시 이동시키려 하면 에러", () => {
    expect(() => moveForward({ kind: "finished" }, 1, false)).toThrow();
  });

  describe("지름길 진입 (모서리에서 useShortcut=true)", () => {
    it("1칸(도)이면 shortcutIn 1단계", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 1, true);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 1 });
    });

    it("2칸(개)이면 shortcutIn 2단계", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 2, true);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    });

    it("3칸(걸)이면 중앙에 도착한다", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 3, true);
      expect(result).toEqual({ kind: "center" });
    });

    it("4칸(윷)이면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 4, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("5칸(모)이면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "outer", index: 15 }, 5, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("서로 다른 모서리에서 탄 shortcutIn은 junction이 다르게 기록된다", () => {
      const from5 = moveForward({ kind: "outer", index: 5 }, 1, true);
      const from10 = moveForward({ kind: "outer", index: 10 }, 1, true);
      expect(from5).toEqual({ kind: "shortcutIn", junction: 5, step: 1 });
      expect(from10).toEqual({ kind: "shortcutIn", junction: 10, step: 1 });
    });
  });

  describe("shortcutIn에서 계속 진행 (선택지 없이 자동)", () => {
    it("1단계에서 1칸 더 가면 같은 모서리의 2단계", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, false);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    });

    it("2단계에서 1칸 더 가면 중앙에 도착한다", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 2 }, 1, false);
      expect(result).toEqual({ kind: "center" });
    });

    it("1단계에서 모(5칸)를 가면 중앙과 도착 구간을 다 지나 완주한다(1+5=6)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 10, step: 1 }, 5, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("useShortcut 인자는 무시된다 — 이미 지름길에 올라탄 상태라 선택지가 없다", () => {
      const withTrue = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, true);
      const withFalse = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, false);
      expect(withTrue).toEqual(withFalse);
    });
  });

  describe("center에서 계속 진행 (항상 도착 방향으로 자동)", () => {
    it("1칸 가면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "center" }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("2칸 가면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "center" }, 2, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("3칸 이상 가면 완주한다", () => {
      expect(moveForward({ kind: "center" }, 3, false)).toEqual({ kind: "finished" });
      expect(moveForward({ kind: "center" }, 5, true)).toEqual({ kind: "finished" });
    });
  });

  describe("shortcutOut에서 계속 진행", () => {
    it("1단계에서 1칸 더 가면 2단계", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("1단계에서 2칸 이상 가면 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 2, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("2단계에서 1칸만 더 가도 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 2 }, 1, false);
      expect(result).toEqual({ kind: "finished" });
    });
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

  it("완주한 말은 빽도로도 되살아나지 않고 에러를 던진다", () => {
    expect(() => moveBackward({ kind: "finished" }, { kind: "outer", index: 19 })).toThrow();
  });

  it("지름길 중간칸에 있던 말도 직전 위치(모서리)로 되돌아간다", () => {
    const previous: Position = { kind: "outer", index: 10 };
    const result = moveBackward({ kind: "shortcutIn", junction: 10, step: 1 }, previous);
    expect(result).toEqual(previous);
  });
});

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

  it("지름길 중간칸(shortcutIn/shortcutOut)도 어느 변에도 속하지 않는다", () => {
    expect(sideOf({ kind: "shortcutIn", junction: 5, step: 1 })).toBeNull();
    expect(sideOf({ kind: "shortcutOut", step: 1 })).toBeNull();
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
Expected: FAIL — 새 `shortcutIn`/`shortcutOut` kind가 타입에 없어 타입 에러, 그리고 기존 "1칸=중앙, 2칸=완주" 동작을 가정하던 옛 테스트를 이미 새 기대값으로 교체했으므로 현재 구현은 이 새 기대값을 만족하지 못함(예: `moveForward({kind:"outer",index:5},1,true)`가 지금은 `{kind:"center"}`를 반환하지만 새 테스트는 `{kind:"shortcutIn",junction:5,step:1}`을 기대).

- [ ] **Step 3: 구현**

`server/src/game/position.ts` 파일 전체를 아래로 교체한다:

```ts
export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "shortcutIn"; junction: 5 | 10 | 15; step: 1 | 2 }
  | { kind: "center" }
  | { kind: "shortcutOut"; step: 1 | 2 }
  | { kind: "finished" };

export const SHORTCUT_JUNCTIONS: ReadonlySet<number> = new Set([5, 10, 15]);

/**
 * 지금 서 있는 자리에서 지름길(모서리 진입) 선택지가 있는지 — 모서리에서만 선택 가능하고,
 * 일단 지름길에 올라탄 뒤(shortcutIn/center/shortcutOut)에는 항상 자동으로 도착 방향으로만
 * 진행하므로 선택지가 없다.
 */
export function isAtShortcutJunction(pos: Position): boolean {
  return pos.kind === "outer" && SHORTCUT_JUNCTIONS.has(pos.index);
}

const LAST_OUTER_INDEX = 19;

/**
 * 지름길 경로(모서리→중앙→도착)를 "모서리를 절대값 0으로 하는 6칸짜리 트랙"으로 계산한다.
 * 0=모서리, 1~2=shortcutIn, 3=center, 4~5=shortcutOut, 6 이상=finished.
 * absoluteStep이 1이나 2일 때만 junction이 필요하다(그 외에는 사용하지 않음).
 */
function shortcutPositionFromAbsolute(junction: 5 | 10 | 15 | null, absoluteStep: number): Position {
  if (absoluteStep <= 2) {
    if (junction === null) {
      throw new Error("지름길 진입 단계 계산에 junction이 필요합니다");
    }
    return { kind: "shortcutIn", junction, step: absoluteStep as 1 | 2 };
  }
  if (absoluteStep === 3) {
    return { kind: "center" };
  }
  if (absoluteStep <= 5) {
    return { kind: "shortcutOut", step: (absoluteStep - 3) as 1 | 2 };
  }
  return { kind: "finished" };
}

export function moveForward(from: Position, steps: number, useShortcut: boolean): Position {
  if (from.kind === "finished") {
    throw new Error("이미 완주한 말은 이동할 수 없습니다");
  }

  // 지름길 모서리에서 지름길을 선택한 경우 — 절대값 0(모서리) + steps
  if (from.kind === "outer" && useShortcut && SHORTCUT_JUNCTIONS.has(from.index)) {
    return shortcutPositionFromAbsolute(from.index as 5 | 10 | 15, steps);
  }

  // 지름길에 이미 올라탄 상태 — 선택지 없이 항상 자동으로 도착 방향까지 진행
  if (from.kind === "shortcutIn") {
    return shortcutPositionFromAbsolute(from.junction, from.step + steps);
  }
  if (from.kind === "center") {
    return shortcutPositionFromAbsolute(null, 3 + steps);
  }
  if (from.kind === "shortcutOut") {
    return shortcutPositionFromAbsolute(null, 3 + from.step + steps);
  }

  const startIndex = from.kind === "start" ? 0 : from.index;
  const nextIndex = startIndex + steps;

  if (nextIndex > LAST_OUTER_INDEX) {
    return { kind: "finished" };
  }
  return { kind: "outer", index: nextIndex };
}

export function moveBackward(from: Position, previousPosition: Position): Position {
  if (from.kind === "finished") {
    throw new Error("이미 완주한 말은 이동할 수 없습니다");
  }

  if (from.kind === "start") {
    return { kind: "start" };
  }
  return previousPosition;
}

export type Side = "A" | "B" | "C" | "D";

const SIDE_RANGES: Array<{ side: Side; min: number; max: number }> = [
  { side: "A", min: 1, max: 5 },
  { side: "B", min: 6, max: 10 },
  { side: "C", min: 11, max: 15 },
  { side: "D", min: 16, max: 19 },
];

/**
 * 보드를 4개의 "변"으로 나눈다(캐릭터 능력의 "같은 줄" 판정용). outer가 아닌 모든 위치
 * (start/center/finished/shortcutIn/shortcutOut)는 어느 변에도 속하지 않는다.
 */
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
Expected: PASS (전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/position.ts server/src/game/position.test.ts
git commit -m "지름길을 모서리→중간칸→중앙→중간칸→도착의 실제 경로로 재설계"
```

---

### Task 2: 잡기/업기가 지름길 칸을 인식하도록 확장 — `pieces.ts`

**Files:**
- Modify: `server/src/game/pieces.ts`
- Test: `server/src/game/pieces.test.ts`

**Interfaces:**
- Consumes: Task 1의 확장된 `Position` 타입(`shortcutIn { junction, step }`, `shortcutOut { step }`).
- Produces: `samePosition(a: Position, b: Position): boolean`(시그니처 동일, 새 kind 인식하도록 동작만 확장). `applyMove`는 변경 없음 — `samePosition`을 그대로 재사용하므로 새 kind에 대한 업기/잡기가 자동으로 동작한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/game/pieces.test.ts`의 `describe("applyMove", ...)` 블록 끝(마지막 `it` 뒤, 닫는 `});` 앞)에 아래 테스트 3개를 추가한다:

```ts
  it("지름길 중간칸(shortcutIn)에서도 같은 모서리+같은 단계면 업기가 성립한다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false);
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    expect(p2.position).toEqual({ kind: "shortcutIn", junction: 5, step: 2 }); // 같이 이동
  });

  it("같은 단계라도 지름길 진입 모서리가 다르면 다른 칸으로 취급해 업기가 안 된다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutIn", junction: 10, step: 1 },
        previousPosition: { kind: "outer", index: 10 },
      },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false);
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p2.position).toEqual({ kind: "shortcutIn", junction: 10, step: 1 }); // 그대로, 업기 안 됨
  });

  it("지름길 중간칸에서 상대 팀 말을 잡을 수 있다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "outer", index: 5 },
        previousPosition: { kind: "start" },
      },
      {
        id: "enemy1",
        ownerId: "bob",
        teamId: "B",
        character: "마담",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
    ];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 1, true);
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- pieces.test.ts`
Expected: FAIL — `samePosition`이 `shortcutIn`/`shortcutOut`를 인식하지 못해(마지막 `return false`로 떨어짐) 업기·잡기가 성립하지 않음(첫 번째 테스트는 p2가 그대로 남아있어 실패, 세 번째 테스트는 `capturedPieceIds`가 빈 배열이라 실패).

- [ ] **Step 3: 구현**

`server/src/game/pieces.ts`의 `samePosition` 함수를 아래로 교체한다:

```ts
export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  return false;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- pieces.test.ts`
Expected: PASS (전체 통과)

- [ ] **Step 5: 커밋**

```bash
git add server/src/game/pieces.ts server/src/game/pieces.test.ts
git commit -m "잡기/업기 판정이 지름길 중간칸을 outer/center와 동일하게 인식하도록 확장"
```

---

### Task 3: 서버 상태 인코딩 왕복 변환 확장 — `MatchState.ts`

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Test: `server/src/rooms/MatchState.test.ts`

**Interfaces:**
- Consumes: Task 1의 확장된 `Position` 타입.
- Produces: `toSchemaPosition(pos: Position): { kind: string; index: number }`(시그니처 동일, `shortcutIn`→`"shortcutIn5"/"shortcutIn10"/"shortcutIn15"`, `shortcutOut`→`"shortcutOut"` 인코딩 추가). `fromSchemaPosition(kind: string, index: number): Position`(역변환 추가).

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchState.test.ts`의 `describe("Position <-> Schema 변환", ...)` 블록 끝(마지막 `it` 뒤, 닫는 `});` 앞)에 아래 테스트 2개를 추가한다:

```ts
  it("shortcutIn은 진입 모서리별로 다른 kind 문자열로 저장되고 왕복 변환된다", () => {
    for (const junction of [5, 10, 15] as const) {
      for (const step of [1, 2] as const) {
        const position = { kind: "shortcutIn" as const, junction, step };
        const schema = toSchemaPosition(position);
        expect(schema).toEqual({ kind: `shortcutIn${junction}`, index: step });
        expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
      }
    }
  });

  it("shortcutOut은 왕복 변환된다", () => {
    for (const step of [1, 2] as const) {
      const position = { kind: "shortcutOut" as const, step };
      const schema = toSchemaPosition(position);
      expect(schema).toEqual({ kind: "shortcutOut", index: step });
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
    }
  });
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test --workspace server -- MatchState.test.ts`
Expected: FAIL — `toSchemaPosition`이 `shortcutIn`/`shortcutOut`를 마지막 `return { kind: pos.kind, index: -1 }` 분기로 흘려보내 `index`가 -1로 나와 기대값(`index: step`)과 불일치. 타입 에러도 함께 발생(현재 `fromSchemaPosition`의 반환 타입 캐스팅이 새 kind를 모름).

- [ ] **Step 3: 구현**

`server/src/rooms/MatchState.ts`에서 `PieceSchema`의 주석과 `toSchemaPosition`/`fromSchemaPosition` 함수를 아래로 교체한다:

```ts
export class PieceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerSessionId: string = "";
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  @type("string") character: string = "";
  // "start" | "outer" | "shortcutIn5" | "shortcutIn10" | "shortcutIn15" | "center" | "shortcutOut" | "finished"
  @type("string") positionKind: string = "start";
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
}
```

```ts
export function toSchemaPosition(pos: Position): { kind: string; index: number } {
  if (pos.kind === "outer") {
    return { kind: "outer", index: pos.index };
  }
  if (pos.kind === "shortcutIn") {
    return { kind: `shortcutIn${pos.junction}`, index: pos.step };
  }
  if (pos.kind === "shortcutOut") {
    return { kind: "shortcutOut", index: pos.step };
  }
  return { kind: pos.kind, index: -1 };
}

export function fromSchemaPosition(kind: string, index: number): Position {
  if (kind === "outer") {
    return { kind: "outer", index };
  }
  if (kind === "shortcutIn5" || kind === "shortcutIn10" || kind === "shortcutIn15") {
    const junction = Number(kind.slice("shortcutIn".length)) as 5 | 10 | 15;
    return { kind: "shortcutIn", junction, step: index as 1 | 2 };
  }
  if (kind === "shortcutOut") {
    return { kind: "shortcutOut", step: index as 1 | 2 };
  }
  return { kind: kind as "start" | "center" | "finished" };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test --workspace server -- MatchState.test.ts`
Expected: PASS (전체 통과)

Run: `npm test --workspace server`
Expected: 서버 전체 테스트 스위트 통과(회귀 없음)

Run: `npm run build --workspace server`
Expected: 타입 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchState.test.ts
git commit -m "지름길 중간칸을 서버 상태(Colyseus schema)로 왕복 변환하도록 확장"
```

---

### Task 4: 클라이언트 타입 정합성 — `matchTypes.ts`

**Files:**
- Modify: `client/src/game/matchTypes.ts`

**Interfaces:**
- Consumes: Task 3의 서버 스키마 인코딩(`positionKind` 값에 `"shortcutIn5"`/`"shortcutIn10"`/`"shortcutIn15"`/`"shortcutOut"` 추가) — 클라이언트가 서버 스키마를 손으로 미러링하는 기존 관례.

**배경:** 이 태스크는 타입만 맞춘다. 지름길 중간칸에 있는 말을 화면에 실제로 그리는 로직(어느 좌표에 놓을지 등)은 이 플랜의 범위 밖이며(스펙 §7, 후속 "보드 시각화" 스펙에서 다룸), 지금 `GameBoard.tsx`는 `positionKind`가 `"outer"`/`"center"`/`"start"`/`"finished"`일 때만 말을 그리므로 **지름길 중간칸에 있는 말은 이 플랜이 끝난 시점에는 화면 어디에도 안 보이는 알려진 공백 상태**가 된다(서버 상태 자체는 정상, 클라이언트 표시만 비어 있음) — 다음 "보드 시각화" 플랜이 이 공백을 메운다. 이 태스크에서 임시로 때우지 않는다(어차피 다음 플랜이 실제 좌표로 다시 그릴 것이므로 낭비되는 작업).

- [ ] **Step 1: 구현**

`client/src/game/matchTypes.ts`의 `PositionKind` 타입을 아래로 교체:

```ts
export type PositionKind =
  | "start"
  | "outer"
  | "shortcutIn5"
  | "shortcutIn10"
  | "shortcutIn15"
  | "center"
  | "shortcutOut"
  | "finished";
```

- [ ] **Step 2: 타입체크**

Run: `npm run build --workspace client`
Expected: 타입 에러 없음(`tsc -b && vite build` 성공) — `PositionKind`를 사용하는 기존 코드(`GameBoard.tsx`, `TurnPanel.tsx`)는 문자열 동등 비교(`===`)만 하고 있어 유니언에 멤버가 늘어나는 것 자체는 컴파일을 깨지 않는다.

- [ ] **Step 3: 커밋**

```bash
git add client/src/game/matchTypes.ts
git commit -m "클라이언트 PositionKind 타입에 지름길 중간칸 문자열 반영(서버 스키마 미러링)"
```

---

## Self-Review 결과

- **스펙 커버리지:** §1(실제 윷판 구조)과 §2(중앙 통과 후 자동 진행, 접근법 A 채택)는 Task 1의 데이터 모델/이동 로직에 반영. §3(데이터 모델)은 Task 1. §4(이동 로직, 6칸 절대값 트랙)는 Task 1. §5(업기/잡기)는 Task 2. §6(서버 상태 인코딩)은 Task 3. §7(영향받지 않는 부분 — abilities.ts, moveBackward, TurnPanel.tsx 체크박스 조건, MatchRoom.ts, 클라이언트 시각화)은 각 태스크에서 손대지 않음으로써 그대로 지켜짐, Task 4에서 명시적으로 "시각화는 범위 밖"임을 재확인. §8(테스트 전략)은 세 태스크 모두 TDD로 반영. §9(범위 제외)는 어떤 태스크에도 포함하지 않아 자연히 지켜짐. 누락 없음.
- **플레이스홀더 스캔:** "TBD"/"TODO"/"적절히 처리" 패턴 없음. 모든 스텝에 실행 가능한 실제 코드 포함.
- **타입 일관성 확인:** `Position`의 `shortcutIn { junction: 5|10|15; step: 1|2 }` / `shortcutOut { step: 1|2 }`(Task 1)가 Task 2의 `samePosition`, Task 3의 `toSchemaPosition`/`fromSchemaPosition`에서 정확히 같은 필드명(`junction`, `step`)과 타입으로 재사용됨을 확인. `shortcutPositionFromAbsolute`가 반환하는 값의 절대값 경계(1~2/3/4~5/6+)가 Task 1의 표(§4 대응)와 모든 테스트 케이스에서 일치함을 재확인. Task 3의 kind 문자열 인코딩(`shortcutIn5`/`shortcutIn10`/`shortcutIn15`/`shortcutOut`)이 Task 4의 클라이언트 `PositionKind` 타입과 정확히 같은 문자열 집합임을 확인.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-22-diagonal-shortcut-model.md`. 실행 방식을 선택해주세요:

1. **Subagent-Driven (권장)** — 태스크마다 새 서브에이전트를 붙여 구현시키고, 태스크 사이사이 리뷰하며 빠르게 진행합니다.
2. **Inline Execution** — 이 세션에서 executing-plans로 배치 실행하고, 체크포인트마다 검토합니다.

어느 쪽으로 진행할까요?
