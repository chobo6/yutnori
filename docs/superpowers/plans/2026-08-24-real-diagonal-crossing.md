# 지름길 5↔15번 실제 교차 대각선 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 지름길 모델을 "어디서 타든 항상 완주 방향"인 단순화 모델에서, 5번 모서리만 실제로 15번 쪽으로 건너가는(진짜 교차) 모델로 재설계한다. 10번/15번은 기존과 동일하게 완주 방향을 유지한다(15번은 사용자가 명시적으로 예외 처리를 선택함).

**Architecture:** 서버(`server/src/game/position.ts`)의 `Position` 판별 유니언에 `shortcutCross`(신규 kind)를 추가하고 `center`에 `exitVia: "finish" | "cross"` 필드를 추가한다. `moveForward`는 진입 모서리가 5번인지에 따라 기존 "finish" 경로 계산과 신규 "cross" 경로 계산으로 분기한다. 클라이언트는 서버 로직을 그대로 손으로 미러링하는 이 프로젝트의 기존 관례를 따라 `matchTypes.ts`/`boardCoords.ts`/`movePath.ts`/`TurnPanel.tsx`를 동일한 패턴으로 갱신한다.

**Tech Stack:** TypeScript, Vitest(서버 테스트), Colyseus Schema(서버 상태 동기화), React 19(클라이언트, 자동화 테스트 없음 — `npm run build` + 실제 브라우저 확인으로 검증).

**Spec:** [`docs/superpowers/specs/2026-08-24-real-diagonal-crossing-design.md`](../specs/2026-08-24-real-diagonal-crossing-design.md)

## Global Constraints

- 10번/15번 모서리 지름길의 기존 동작(값)은 **절대 바뀌면 안 된다** — 회귀 테스트로 반드시 확인.
- `Position` 타입의 `outer`/`shortcutIn`/`shortcutOut`/`start`/`finished` variant는 필드 구조를 바꾸지 않는다 — `center`에 `exitVia` 필드 추가, `shortcutCross` variant 신규 추가만 허용.
- 서버 상태 스키마(`MatchState.ts`)는 필드를 추가하지 않고 기존 `positionKind: string` + `positionIndex: number` 2필드 방식을 그대로 재사용한다(kind 문자열만 늘어남: `"centerCross"`, `"shortcutCross"`).
- 클라이언트에는 자동화 테스트 프레임워크가 없다 — 클라이언트 작업은 `npm run build`(타입체크) + 실제 브라우저 확인으로 검증한다. 새 기능을 "테스트 통과"로 보고하기 전에 반드시 브라우저에서 5번 모서리 지름길 애니메이션을 직접 확인할 것(`CLAUDE.md` 명시).
- 커밋 메시지는 한국어로, `feat:`/`fix:` 같은 프리픽스 없이 작성한다(이 프로젝트 전체 관례).

---

## Task 1: 서버 Position 타입 + moveForward 재설계

**Files:**
- Modify: `server/src/game/position.ts`
- Test: `server/src/game/position.test.ts`

**Interfaces:**
- Consumes: 없음(최하위 순수 로직 파일).
- Produces: `Position` 타입에 `{ kind: "center"; exitVia: "finish" | "cross" }`(필드 추가)와 `{ kind: "shortcutCross"; step: 1 | 2 }`(신규) — Task 2/3/4가 이 타입을 그대로 가져다 쓴다. `moveForward(from, steps, useShortcut)` 시그니처는 변경 없음.

- [ ] **Step 1: 실패하는 테스트 작성 — 5번에서 지름길을 타면 15번 쪽 교차 트랙으로 간다**

`server/src/game/position.test.ts`의 `describe("지름길 진입 (모서리에서 useShortcut=true)")` 블록 안, 기존 "3칸(걸)이면 중앙에 도착한다" 테스트(현재 39-71번째 줄 부근) 바로 뒤에 아래 테스트들을 추가한다:

```ts
    it("5번에서 3칸(걸)이면 중앙에 도착하고 cross 트랙으로 기록된다", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 3, true);
      expect(result).toEqual({ kind: "center", exitVia: "cross" });
    });

    it("10번/15번에서 3칸(걸)이면 중앙에 도착하고 finish 트랙으로 기록된다(기존 동작 유지)", () => {
      expect(moveForward({ kind: "outer", index: 10 }, 3, true)).toEqual({ kind: "center", exitVia: "finish" });
      expect(moveForward({ kind: "outer", index: 15 }, 3, true)).toEqual({ kind: "center", exitVia: "finish" });
    });

    it("5번에서 4칸(윷)이면 shortcutCross 1단계다(shortcutOut이 아님)", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 4, true);
      expect(result).toEqual({ kind: "shortcutCross", step: 1 });
    });

    it("5번에서 5칸(모)이면 shortcutCross 2단계다", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 5, true);
      expect(result).toEqual({ kind: "shortcutCross", step: 2 });
    });
```

같은 파일의 `describe("shortcutIn에서 계속 진행 (선택지 없이 자동)")` 블록 끝(94번째 줄 부근, 마지막 `it` 다음) 바로 뒤에 추가:

```ts
    it("5번 shortcutIn 2단계에서 1칸 더 가면 cross 트랙 중앙에 도착한다", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 2 }, 1, false);
      expect(result).toEqual({ kind: "center", exitVia: "cross" });
    });

    it("10번/15번 shortcutIn 2단계에서 1칸 더 가면 finish 트랙 중앙에 도착한다(기존 동작 유지)", () => {
      expect(moveForward({ kind: "shortcutIn", junction: 10, step: 2 }, 1, false)).toEqual({
        kind: "center",
        exitVia: "finish",
      });
      expect(moveForward({ kind: "shortcutIn", junction: 15, step: 2 }, 1, false)).toEqual({
        kind: "center",
        exitVia: "finish",
      });
    });
```

새 `describe` 블록을 파일 끝(`describe("moveBackward", ...)` 앞, 130번째 줄 부근)에 추가:

```ts
describe("cross 트랙 (5번 지름길 — 15번으로 실제 교차)", () => {
  it("centerCross(중앙, exitVia=cross)에서 1칸 가면 shortcutCross 1단계", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 1, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 1 });
  });

  it("centerCross에서 2칸 가면 shortcutCross 2단계", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 2, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 2 });
  });

  it("centerCross에서 3칸 가면 정확히 외곽 15번 칸에 착지한다(완주가 아님)", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  it("shortcutCross 1단계에서 1칸 더 가면 2단계", () => {
    const result = moveForward({ kind: "shortcutCross", step: 1 }, 1, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 2 });
  });

  it("shortcutCross 1단계에서 2칸 더 가면 외곽 15번 칸(완주 아님)", () => {
    const result = moveForward({ kind: "shortcutCross", step: 1 }, 2, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  it("shortcutCross 2단계에서 1칸 더 가면 외곽 15번 칸", () => {
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 1, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  it("shortcutCross 2단계에서 여러 칸 가면 15번을 넘어 정상적으로 바깥길을 계속 간다(15+2=17)", () => {
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 17 });
  });

  it("cross 트랙에서 완주 지점(19)을 넘기면 정상적으로 완주한다", () => {
    // shortcutCross step2(절대값5) + 6칸 = 절대값11 → outer(15+5)=20 → 19 초과 → finished
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 6, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("useShortcut 인자는 cross 트랙에서도 무시된다", () => {
    const withTrue = moveForward({ kind: "shortcutCross", step: 1 }, 1, true);
    const withFalse = moveForward({ kind: "shortcutCross", step: 1 }, 1, false);
    expect(withTrue).toEqual(withFalse);
  });
});
```

기존 `sideOf`/`sameSide` 테스트 중 `{ kind: "center" }`를 그대로 쓰는 두 곳을 고친다 — 175-179번째 줄 부근:

```ts
  it("start/center/finished는 어느 변에도 속하지 않는다", () => {
    expect(sideOf({ kind: "start" })).toBeNull();
    expect(sideOf({ kind: "center", exitVia: "finish" })).toBeNull();
    expect(sideOf({ kind: "finished" })).toBeNull();
  });
```

그리고 196-200번째 줄 부근 `sameSide` 테스트:

```ts
  it("둘 중 하나라도 변이 없으면(start/center/finished) false", () => {
    expect(sameSide({ kind: "start" }, { kind: "outer", index: 3 })).toBe(false);
    expect(sameSide({ kind: "outer", index: 3 }, { kind: "center", exitVia: "finish" })).toBe(false);
    expect(sameSide({ kind: "finished" }, { kind: "start" })).toBe(false);
  });
```

기존 `describe("지름길 진입 ...")` 안의 "3칸(걸)이면 중앙에 도착한다" 테스트(junction 10 사용, 50-53번째 줄 부근)도 `exitVia`를 포함하도록 고친다:

```ts
    it("3칸(걸)이면 중앙에 도착한다", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 3, true);
      expect(result).toEqual({ kind: "center", exitVia: "finish" });
    });
```

그리고 `describe("shortcutIn에서 계속 진행 ...")` 안의 "2단계에서 1칸 더 가면 중앙에 도착한다"(79-82번째 줄 부근, junction 5 사용 — **이 테스트는 재설계로 실제 동작이 바뀌는 지점**이므로 exitVia를 "cross"로 갱신):

```ts
    it("2단계에서 1칸 더 가면 중앙에 도착한다(5번 진입이므로 cross 트랙)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 2 }, 1, false);
      expect(result).toEqual({ kind: "center", exitVia: "cross" });
    });
```

`describe("center에서 계속 진행 (항상 도착 방향으로 자동)")` 블록 전체(96-111번째 줄 부근)를 아래로 교체 — 기존 블록은 "10번/15번에서 진입한 center"(finish 트랙)만 다루던 것으로 명확히 하고, exitVia를 명시한다:

```ts
  describe("center(exitVia=finish)에서 계속 진행 (10번/15번 진입 — 항상 도착 방향으로 자동)", () => {
    it("1칸 가면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "center", exitVia: "finish" }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("2칸 가면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "center", exitVia: "finish" }, 2, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("3칸 이상 가면 완주한다", () => {
      expect(moveForward({ kind: "center", exitVia: "finish" }, 3, false)).toEqual({ kind: "finished" });
      expect(moveForward({ kind: "center", exitVia: "finish" }, 5, true)).toEqual({ kind: "finished" });
    });
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/position.test.ts`
Expected: 컴파일 에러(타입 에러) 또는 다수의 테스트 실패 — `Position` 타입에 아직 `exitVia`/`shortcutCross`가 없고 `moveForward`도 5번을 특별 취급하지 않기 때문.

- [ ] **Step 3: `Position` 타입과 `moveForward` 구현**

`server/src/game/position.ts` 전체를 아래로 교체한다:

```ts
export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "shortcutIn"; junction: 5 | 10 | 15; step: 1 | 2 }
  | { kind: "center"; exitVia: "finish" | "cross" }
  | { kind: "shortcutOut"; step: 1 | 2 }
  | { kind: "shortcutCross"; step: 1 | 2 }
  | { kind: "finished" };

export const SHORTCUT_JUNCTIONS: ReadonlySet<number> = new Set([5, 10, 15]);

const LAST_OUTER_INDEX = 19;

/**
 * "finish" 트랙(10번/15번 진입, 항상 완주 방향으로 나감) 경로를 "모서리를 절대값 0으로 하는
 * 6칸짜리 트랙"으로 계산한다. 0=모서리, 1~2=shortcutIn, 3=center(exitVia:"finish"), 4~5=shortcutOut,
 * 6 이상=finished.
 */
function shortcutPositionFromAbsolute(junction: 5 | 10 | 15 | null, absoluteStep: number): Position {
  if (absoluteStep < 1) {
    throw new Error("지름길 절대값은 1 이상이어야 합니다");
  }
  if (absoluteStep <= 2) {
    if (junction === null) {
      throw new Error("지름길 진입 단계 계산에 junction이 필요합니다");
    }
    return { kind: "shortcutIn", junction, step: absoluteStep as 1 | 2 };
  }
  if (absoluteStep === 3) {
    return { kind: "center", exitVia: "finish" };
  }
  if (absoluteStep <= 5) {
    return { kind: "shortcutOut", step: (absoluteStep - 3) as 1 | 2 };
  }
  return { kind: "finished" };
}

/**
 * "cross" 트랙(5번 진입 전용, 실제로 15번 쪽으로 건너간다) 경로 — 같은 절대값 체계를 쓰되
 * 6 이상은 finished가 아니라 외곽 15번 칸(그리고 그 이후는 평범한 바깥길)으로 이어진다.
 * docs/superpowers/specs/2026-08-24-real-diagonal-crossing-design.md §2 참고.
 */
function crossPositionFromAbsolute(absoluteStep: number): Position {
  if (absoluteStep < 1) {
    throw new Error("지름길 절대값은 1 이상이어야 합니다");
  }
  if (absoluteStep <= 2) {
    return { kind: "shortcutIn", junction: 5, step: absoluteStep as 1 | 2 };
  }
  if (absoluteStep === 3) {
    return { kind: "center", exitVia: "cross" };
  }
  if (absoluteStep <= 5) {
    return { kind: "shortcutCross", step: (absoluteStep - 3) as 1 | 2 };
  }
  const outerIndex = 15 + (absoluteStep - 6);
  if (outerIndex > LAST_OUTER_INDEX) {
    return { kind: "finished" };
  }
  return { kind: "outer", index: outerIndex };
}

export function moveForward(from: Position, steps: number, useShortcut: boolean): Position {
  if (from.kind === "finished") {
    throw new Error("이미 완주한 말은 이동할 수 없습니다");
  }

  // 지름길 모서리에서 지름길을 선택한 경우 — 5번은 cross 트랙, 10/15번은 기존 finish 트랙.
  if (from.kind === "outer" && useShortcut && SHORTCUT_JUNCTIONS.has(from.index)) {
    if (from.index === 5) {
      return crossPositionFromAbsolute(steps);
    }
    return shortcutPositionFromAbsolute(from.index as 10 | 15, steps);
  }

  // 지름길에 이미 올라탄 상태 — 선택지 없이 항상 자동으로 도착 방향까지 진행.
  // 어느 트랙을 타고 있었는지(junction===5 → cross, 아니면 finish)에 따라 분기한다.
  if (from.kind === "shortcutIn") {
    if (from.junction === 5) {
      return crossPositionFromAbsolute(from.step + steps);
    }
    return shortcutPositionFromAbsolute(from.junction, from.step + steps);
  }
  if (from.kind === "center") {
    if (from.exitVia === "cross") {
      return crossPositionFromAbsolute(3 + steps);
    }
    return shortcutPositionFromAbsolute(null, 3 + steps);
  }
  if (from.kind === "shortcutCross") {
    return crossPositionFromAbsolute(3 + from.step + steps);
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
 * (start/center/finished/shortcutIn/shortcutOut/shortcutCross)는 어느 변에도 속하지 않는다.
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

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/position.test.ts`
Expected: 전체 PASS.

- [ ] **Step 5: 서버 전체 테스트 스위트로 회귀 확인**

Run: `cd server && npm test`
Expected: 전체 PASS(이 시점엔 `pieces.ts`/`abilities.ts`/`MatchState.ts`가 아직 `Position` 타입 변경에 안 맞아 타입 에러가 날 수 있다 — 그렇다면 Task 2/3에서 고친다는 걸 확인하고 넘어간다. 만약 `position.test.ts` 자체가 깨졌다면 이 태스크 안에서 먼저 고친다).

- [ ] **Step 6: 커밋**

```bash
git add server/src/game/position.ts server/src/game/position.test.ts
git commit -m "지름길 5번 모서리만 15번으로 실제 교차하도록 Position 모델과 moveForward를 재설계했다"
```

---

## Task 2: 업기/잡기(`samePosition`)와 교주 능력(`onBoard`) 대응

**Files:**
- Modify: `server/src/game/pieces.ts`
- Test: `server/src/game/pieces.test.ts`
- Modify: `server/src/game/abilities.ts`
- Test: `server/src/game/abilities.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Position`(`shortcutCross`, `center.exitVia`).
- Produces: `samePosition`이 `shortcutCross`끼리도 올바르게 비교(Task 4의 클라이언트 로직과는 무관, 서버 전용). `onBoard`(비공개 함수, `abilities.ts` 내부)가 `shortcutCross`를 보드 위로 인정.

- [ ] **Step 1: 실패하는 테스트 작성 — `samePosition`이 shortcutCross를 인식해야 한다**

`server/src/game/pieces.test.ts`의 `describe("applyMove", ...)` 블록 끝(파일 끝 부근, 마지막 `it` 뒤)에 추가한다. 정확한 위치를 모르면 파일 끝에 그대로 추가해도 된다:

```ts
describe("samePosition — cross 트랙(shortcutCross)", () => {
  it("같은 step의 shortcutCross는 같은 칸으로 취급되어 업힌다", () => {
    // applyMove는 "이동 전(previousPosition이 아니라 현재 position) 위치 기준"으로 업기를
    // 판정한다(CLAUDE.md) — p1과 p2를 둘 다 shortcutCross(step:1)에 세워두고 p2를 1칸
    // 이동시키면, p2의 이동 전 위치(shortcutCross step:1)에 같은 주인의 p1이 있었으므로
    // p1도 함께 업혀서 이동해야 한다.
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "shortcutIn", junction: 5, step: 2 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "shortcutIn", junction: 5, step: 2 },
      },
    ];
    const { pieces: result, piggybackedIds } = applyMove(pieces, "p2", 1, false);
    expect(piggybackedIds).toEqual(["p1"]);
    const p1 = result.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "shortcutCross", step: 2 });
  });
});
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/pieces.test.ts`
Expected: FAIL — `samePosition`에 `shortcutCross` 분기가 없어 `piggybackedIds`가 빈 배열로 나온다(또는 타입 에러 — `Piece.position`에 `shortcutCross`가 아직 없다면 Task 1이 끝나 있어야 하므로 타입 에러는 없어야 정상).

- [ ] **Step 3: `samePosition`에 `shortcutCross` 분기 추가**

`server/src/game/pieces.ts`의 `samePosition` 함수(23-29번째 줄)를 아래로 교체:

```ts
export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true; // exitVia는 물리적 위치와 무관 — 비교하지 않는다
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  if (a.kind === "shortcutCross" && b.kind === "shortcutCross") return a.step === b.step;
  return false;
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/pieces.test.ts`
Expected: PASS.

- [ ] **Step 5: 실패하는 테스트 작성 — 교주 보너스가 shortcutCross 위치에서도 발동해야 한다**

`server/src/game/abilities.test.ts`의 `describe("applyGyojuBonus", ...)` 블록 끝(60번째 줄 부근, 마지막 `it` 뒤)에 추가:

```ts
  it("이동한 말이 shortcutCross 위치(5번 지름길 교차 구간)에 있어도 보너스가 발동한다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "shortcutIn", junction: 5, step: 2 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "start" },
      },
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    expect(result.fired).toBe(true);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "shortcutCross", step: 2 }); // 1칸 추가 전진
  });
```

- [ ] **Step 6: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/game/abilities.test.ts`
Expected: FAIL — `onBoard`가 `shortcutCross`를 보드 위로 인정하지 않아 `applyGyojuBonus`가 조기 리턴(`fired: false`)한다.

- [ ] **Step 7: `onBoard`에 `shortcutCross` 추가**

`server/src/game/abilities.ts`의 `onBoard` 함수(38-45번째 줄)를 아래로 교체:

```ts
function onBoard(position: Position): boolean {
  return (
    position.kind === "outer" ||
    position.kind === "center" ||
    position.kind === "shortcutIn" ||
    position.kind === "shortcutOut" ||
    position.kind === "shortcutCross"
  );
}
```

- [ ] **Step 8: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/game/abilities.test.ts`
Expected: PASS.

- [ ] **Step 9: 커밋**

```bash
git add server/src/game/pieces.ts server/src/game/pieces.test.ts server/src/game/abilities.ts server/src/game/abilities.test.ts
git commit -m "업기/잡기 판정과 교주 능력이 새 shortcutCross 위치도 인식하도록 고쳤다"
```

---

## Task 3: 서버 상태 스키마 인코딩

**Files:**
- Modify: `server/src/rooms/MatchState.ts`
- Test: `server/src/rooms/MatchState.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Position` 타입.
- Produces: `toSchemaPosition`/`fromSchemaPosition`이 `centerCross`/`shortcutCross` 문자열을 왕복 변환 — Task 4의 클라이언트가 `room.state.pieces[].positionKind`로 받는 정확한 문자열 값들("center" | "centerCross" | "shortcutCross" | 기존 값들)이 여기서 확정된다.

- [ ] **Step 1: 실패하는 테스트 작성**

`server/src/rooms/MatchState.test.ts`의 29-35번째 줄 "start/center/finished는 index -1로 저장되고 복원된다" 테스트를 아래로 교체(더 이상 `center`를 단순 루프에 포함시킬 수 없으므로 분리):

```ts
  it("start/finished는 index -1로 저장되고 복원된다", () => {
    for (const kind of ["start", "finished"] as const) {
      const schema = toSchemaPosition({ kind });
      expect(schema.index).toBe(-1);
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind });
    }
  });

  it("center(exitVia=finish)는 'center' kind 문자열로, exitVia=cross는 'centerCross'로 왕복 변환된다", () => {
    const finish = toSchemaPosition({ kind: "center", exitVia: "finish" });
    expect(finish).toEqual({ kind: "center", index: -1 });
    expect(fromSchemaPosition(finish.kind, finish.index)).toEqual({ kind: "center", exitVia: "finish" });

    const cross = toSchemaPosition({ kind: "center", exitVia: "cross" });
    expect(cross).toEqual({ kind: "centerCross", index: -1 });
    expect(fromSchemaPosition(cross.kind, cross.index)).toEqual({ kind: "center", exitVia: "cross" });
  });

  it("shortcutCross는 왕복 변환된다", () => {
    for (const step of [1, 2] as const) {
      const position = { kind: "shortcutCross" as const, step };
      const schema = toSchemaPosition(position);
      expect(schema).toEqual({ kind: "shortcutCross", index: step });
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
    }
  });
```

- [ ] **Step 2: 테스트 실행해서 실패 확인**

Run: `cd server && npx vitest run src/rooms/MatchState.test.ts`
Expected: FAIL(타입 에러 또는 assertion 실패) — `toSchemaPosition`/`fromSchemaPosition`이 아직 `centerCross`/`shortcutCross`를 모른다.

- [ ] **Step 3: `toSchemaPosition`/`fromSchemaPosition` 구현**

`server/src/rooms/MatchState.ts`의 17번째 줄(주석)을 갱신:

```ts
  // "start" | "outer" | "shortcutIn5" | "shortcutIn10" | "shortcutIn15" | "center" | "centerCross" | "shortcutOut" | "shortcutCross" | "finished"
  @type("string") positionKind: string = "start";
```

같은 파일의 `toSchemaPosition`/`fromSchemaPosition`(49-74번째 줄)을 아래로 교체:

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
  if (pos.kind === "shortcutCross") {
    return { kind: "shortcutCross", index: pos.step };
  }
  if (pos.kind === "center") {
    return { kind: pos.exitVia === "cross" ? "centerCross" : "center", index: -1 };
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
  if (kind === "shortcutCross") {
    return { kind: "shortcutCross", step: index as 1 | 2 };
  }
  if (kind === "center") {
    return { kind: "center", exitVia: "finish" };
  }
  if (kind === "centerCross") {
    return { kind: "center", exitVia: "cross" };
  }
  return { kind: kind as "start" | "finished" };
}
```

- [ ] **Step 4: 테스트 실행해서 통과 확인**

Run: `cd server && npx vitest run src/rooms/MatchState.test.ts`
Expected: PASS.

- [ ] **Step 5: 서버 전체 테스트 + 타입체크**

Run: `cd server && npm test && npm run build`
Expected: 전체 PASS, 타입 에러 없음. (이 시점에 서버 쪽 `Position` 관련 변경은 전부 끝나야 한다 — 실패하면 Task 1/2/3 중 어디가 빠졌는지 확인).

- [ ] **Step 6: 커밋**

```bash
git add server/src/rooms/MatchState.ts server/src/rooms/MatchState.test.ts
git commit -m "서버 상태 스키마가 centerCross/shortcutCross 위치를 문자열 kind로 인코딩/복원하도록 갱신했다"
```

---

## Task 4: 클라이언트 미러링(타입/좌표/이동경로/UI 라벨) + 브라우저 검증

**Files:**
- Modify: `client/src/game/matchTypes.ts`
- Modify: `client/src/game/boardCoords.ts`
- Modify: `client/src/game/movePath.ts`
- Modify: `client/src/components/TurnPanel.tsx`

**Interfaces:**
- Consumes: Task 3에서 확정된 서버 문자열 값("center" | "centerCross" | "shortcutOut" | "shortcutCross" | 기존 값들, `positionIndex`는 `shortcutCross`일 때 1|2).
- Produces: 없음(최상위 UI 레이어 — 클라이언트 자동화 테스트가 없으므로 `npm run build` + 브라우저 확인으로 검증).

- [ ] **Step 1: `PositionKind`에 신규 kind 추가**

`client/src/game/matchTypes.ts`의 `PositionKind`(1-9번째 줄)를 아래로 교체:

```ts
export type PositionKind =
  | "start"
  | "outer"
  | "shortcutIn5"
  | "shortcutIn10"
  | "shortcutIn15"
  | "center"
  | "centerCross"
  | "shortcutOut"
  | "shortcutCross"
  | "finished";
```

- [ ] **Step 2: `npm run build`로 타입 에러 목록 확인**

Run: `cd client && npm run build`
Expected: FAIL — `boardCoords.ts`의 `positionToCoords` switch가 새 kind를 처리하지 않아 "not all code paths return a value" 류 에러, `TurnPanel.tsx`의 `positionDescription` switch도 마찬가지로 에러. 이 에러 목록이 Step 3/4에서 고쳐야 할 정확한 위치를 알려준다.

- [ ] **Step 3: `boardCoords.ts`에 좌표 계산 추가**

`client/src/game/boardCoords.ts`의 `shortcutOutCoords` 함수(40-42번째 줄) 바로 뒤에 추가:

```ts
/** 5번에서 지름길을 타고 중앙을 건너 15번 쪽으로 가는 구간 — shortcutInCoords(15, step)와 물리적으로
 * 같은 두 칸을 가리키므로(방향만 반대) 같은 corner를 향해 보간한다. */
function shortcutCrossCoords(step: 1 | 2): Coords {
  return lerp(CENTER, CORNERS[JUNCTION_CORNER[15]], step / 3);
}
```

같은 파일의 `positionToCoords` 함수(44-62번째 줄)를 아래로 교체:

```ts
export function positionToCoords(kind: PositionKind, index: number): Coords | null {
  switch (kind) {
    case "outer":
      return outerCoords(index);
    case "center":
    case "centerCross":
      return CENTER;
    case "shortcutIn5":
      return shortcutInCoords(5, index as 1 | 2);
    case "shortcutIn10":
      return shortcutInCoords(10, index as 1 | 2);
    case "shortcutIn15":
      return shortcutInCoords(15, index as 1 | 2);
    case "shortcutOut":
      return shortcutOutCoords(index as 1 | 2);
    case "shortcutCross":
      return shortcutCrossCoords(index as 1 | 2);
    case "start":
    case "finished":
      return null;
  }
}
```

- [ ] **Step 4: `TurnPanel.tsx`에 라벨 추가**

`client/src/components/TurnPanel.tsx`의 `positionDescription` 함수(24-43번째 줄)를 아래로 교체:

```ts
function positionDescription(piece: PieceState): string {
  switch (piece.positionKind) {
    case "start":
      return "대기중";
    case "outer":
      return `${piece.positionIndex}번 칸`;
    case "shortcutIn5":
      return `5번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn10":
      return `10번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn15":
      return `15번 지름길 ${piece.positionIndex}칸`;
    case "center":
    case "centerCross":
      return "중앙";
    case "shortcutOut":
      return `중앙 통과 ${piece.positionIndex}칸`;
    case "shortcutCross":
      return `15번 방향 ${piece.positionIndex}칸`;
    case "finished":
      return "완주";
  }
}
```

- [ ] **Step 5: `npm run build`로 타입 에러 재확인**

Run: `cd client && npm run build`
Expected: `boardCoords.ts`/`TurnPanel.tsx` 관련 에러는 사라짐. `movePath.ts`(Step 6에서 고침)가 아직 안 끝났다면 애니메이션 자체는 틀린 결과를 낼 수 있지만(타입 에러는 없음), 이 시점엔 빌드 자체는 통과해야 한다 — `movePath.ts`는 `PositionKind`를 다루지만 exhaustive switch가 아니라 조건문 나열이라 컴파일러가 누락을 강제하지 않기 때문이다.

- [ ] **Step 6: `movePath.ts`의 이동 경로 계산에 cross 트랙 추가**

`client/src/game/movePath.ts` 전체를 아래로 교체:

```ts
import { SHORTCUT_JUNCTION_INDICES, type PositionKind } from "./matchTypes";

/**
 * server/src/game/position.ts의 moveForward/moveBackward를 손으로 미러링한다(공유 타입
 * 패키지가 없는 이 프로젝트의 확립된 관례 — matchTypes.ts와 동일). 서버는 최종 도착 칸만
 * 상태로 알려주므로, "한 칸씩 거쳐가는" 이동 애니메이션을 그리려면 클라이언트가 중간 칸들을
 * 직접 재계산해야 한다. 이 파일은 순수 시각 연출용이며, 실제 게임 로직(어디로 이동했는지)은
 * 항상 서버 상태(positionKind/positionIndex)를 그대로 신뢰한다 — 여기 계산은 "그 결과까지
 * 어떤 경로로 갔는지"를 보여주기 위한 것일 뿐이다.
 */

const LAST_OUTER_INDEX = 19;

export interface SimplePosition {
  kind: PositionKind;
  index: number;
}

/** "finish" 트랙(10번/15번 진입, server의 shortcutPositionFromAbsolute와 대응) 한 칸 전진. */
function shortcutFromAbsolute(junctionKind: PositionKind, absoluteStep: number): SimplePosition {
  if (absoluteStep <= 2) return { kind: junctionKind, index: absoluteStep };
  if (absoluteStep === 3) return { kind: "center", index: -1 };
  if (absoluteStep <= 5) return { kind: "shortcutOut", index: absoluteStep - 3 };
  return { kind: "finished", index: -1 };
}

/** "cross" 트랙(5번 진입 전용, server의 crossPositionFromAbsolute와 대응) 한 칸 전진.
 * stepForwardOnce가 항상 딱 1칸씩만 계산하므로(아래 computeMovePath의 for 루프 참고),
 * absoluteStep은 여기서 최대 6까지만 나온다 — 6을 넘는 오버플로는 그 다음 호출에서
 * "outer" 케이스(기존 일반 전진 로직)가 알아서 이어받는다. */
function crossFromAbsolute(absoluteStep: number): SimplePosition {
  if (absoluteStep <= 2) return { kind: "shortcutIn5", index: absoluteStep };
  if (absoluteStep === 3) return { kind: "centerCross", index: -1 };
  if (absoluteStep <= 5) return { kind: "shortcutCross", index: absoluteStep - 3 };
  return { kind: "outer", index: 15 };
}

function stepForwardOnce(
  pos: SimplePosition,
  useShortcut: boolean,
  junctionKind: PositionKind | null,
): { pos: SimplePosition; junctionKind: PositionKind | null } {
  if (pos.kind === "outer" && useShortcut && SHORTCUT_JUNCTION_INDICES.has(pos.index)) {
    const jk = (`shortcutIn${pos.index}` as PositionKind);
    return { pos: shortcutFromAbsolute(jk, 1), junctionKind: jk };
  }
  if (pos.kind === "shortcutIn5" || pos.kind === "shortcutIn10" || pos.kind === "shortcutIn15") {
    const absoluteStep = pos.index + 1;
    if (pos.kind === "shortcutIn5") {
      return { pos: crossFromAbsolute(absoluteStep), junctionKind: pos.kind };
    }
    return { pos: shortcutFromAbsolute(pos.kind, absoluteStep), junctionKind: pos.kind };
  }
  if (pos.kind === "centerCross") {
    return { pos: crossFromAbsolute(4), junctionKind };
  }
  if (pos.kind === "center") {
    return { pos: shortcutFromAbsolute(junctionKind ?? "shortcutIn5", 4), junctionKind };
  }
  if (pos.kind === "shortcutCross") {
    const absoluteStep = 3 + pos.index + 1;
    return { pos: crossFromAbsolute(absoluteStep), junctionKind };
  }
  if (pos.kind === "shortcutOut") {
    const absoluteStep = 3 + pos.index + 1;
    return { pos: shortcutFromAbsolute(junctionKind ?? "shortcutIn5", absoluteStep), junctionKind };
  }
  const startIndex = pos.kind === "start" ? 0 : pos.index;
  const nextIndex = startIndex + 1;
  if (nextIndex > LAST_OUTER_INDEX) return { pos: { kind: "finished", index: -1 }, junctionKind };
  return { pos: { kind: "outer", index: nextIndex }, junctionKind };
}

export function computeMovePath(from: SimplePosition, steps: number, useShortcut: boolean): SimplePosition[] {
  if (steps <= 0) return [];
  const path: SimplePosition[] = [];
  let current = from;
  let junctionKind: PositionKind | null = null;
  for (let i = 0; i < steps; i++) {
    const stepped = stepForwardOnce(current, useShortcut, junctionKind);
    current = stepped.pos;
    junctionKind = stepped.junctionKind;
    path.push(current);
    if (current.kind === "finished") break;
  }
  return path;
}
```

- [ ] **Step 7: 클라이언트 타입체크**

Run: `cd client && npm run build`
Expected: PASS, 에러 없음.

- [ ] **Step 8: 서버 전체 테스트 스위트로 최종 회귀 확인**

Run: `cd server && npm test`
Expected: 전체 PASS(이 태스크는 클라이언트만 건드리지만, 전체 스위트가 여전히 깨지지 않았는지 마지막으로 확인).

- [ ] **Step 9: 브라우저로 실제 확인**

`npm run dev`(루트에서, 이미 실행 중이 아니라면)로 서버+클라이언트를 띄운다. 1v1 방을 만들어 두 플레이어 모두 캐릭터를 아무거나 고르고 게임을 시작한다. 자신의 말을 5번 칸(외곽 5번)까지 이동시킨 뒤, 5번 칸에서 다시 던져서 "지름길 사용" 체크박스를 켜고 3칸 이상(걸/윷/모) 이동한다. 다음을 확인한다:
- 이동 애니메이션이 5번 모서리에서 중앙을 거쳐 **15번 모서리 쪽 대각선**으로 홉하는지(기존처럼 출발점 쪽 대각선으로 가면 안 됨).
- 정확히 6칸을 이동하면 말이 **외곽 15번 칸**에 착지하는지(완주 처리되면 안 됨).
- 10번이나 15번 모서리에서 지름길을 태우면 **기존과 동일하게** 출발점 방향 대각선으로 이동하고, 6칸 이동 시 완주하는지(회귀 확인).

- [ ] **Step 10: 커밋**

```bash
git add client/src/game/matchTypes.ts client/src/game/boardCoords.ts client/src/game/movePath.ts client/src/components/TurnPanel.tsx
git commit -m "클라이언트가 5번 지름길의 15번 교차 경로를 좌표/애니메이션/UI 라벨까지 서버 로직과 동일하게 반영하도록 갱신했다"
```

---

## 완료 후

전체 4개 태스크가 끝나면 `superpowers:finishing-a-development-branch` 없이(이 프로젝트는 워크트리/브랜치 없이 `main`에 직접 커밋하는 관례) 마지막으로 `docs/REQUIREMENTS.md`에 이번 변경을 반영하는 변경 이력 한 줄과, `CLAUDE.md`의 "보드 좌표계 — 지름길 모델" 절(15번 밸런스 손해를 설명하던 부분)을 이번 재설계 내용에 맞게 갱신한다 — 이건 별도 태스크로 만들 만큼 크지 않으므로 마지막 커밋에 문서만 따로 갱신해서 커밋한다. `git push`는 사용자에게 먼저 확인한다(이 세션 전체의 확립된 패턴).
