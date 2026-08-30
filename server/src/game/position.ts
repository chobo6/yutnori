export type Position =
  | { kind: "start" }
  | { kind: "outer"; index: number }
  | { kind: "shortcutIn"; junction: 5 | 10 | 15; step: 1 | 2 }
  | { kind: "center"; exitVia: "finish" | "cross" }
  | { kind: "shortcutOut"; step: 1 | 2 }
  | { kind: "shortcutCross"; step: 1 | 2 }
  | { kind: "finished" };

// 15번은 지름길 후보에서 제외한다(2026-08-27 변경, 사용자 명시 요청) — 진짜 교차 모델대로면
// 15번에서 타면 5번으로 떨어져 완주에서 오히려 손해고(위 2026-08-24 예외 처리로 finish 방향을
// 유지하게 했었지만, 그래도 바깥길 그대로 가는 것보다 1칸 더 걸려 이득이 없었다 — 15+shortcut=
// 6칸 vs 바깥길 그대로=5칸), 그래서 아예 선택지 자체를 없앴다. 15번에 있는 말은 이제 useShortcut
// 값과 무관하게 항상 바깥길을 그대로 간다. `shortcutIn`의 `junction: 5 | 10 | 15` 타입과 그
// 이어가기 로직은 그대로 남겨뒀다(junction 값과 무관하게 동작하는 범용 코드라 해가 없고,
// 지우면 여러 파일에 걸친 타입 변경이 필요해 배보다 배꼽이 커진다) — 다만 이제 15로는 그
// 상태 자체에 절대 도달하지 않는다.
export const SHORTCUT_JUNCTIONS: ReadonlySet<number> = new Set([5, 10]);

// 도착점(외곽 20번, 시작점과 물리적으로 같은 모서리 칸)에 "정확히 도착"만 해서는 완주하지
// 않는다(2026-08-28 변경, 사용자 명시 요청) — 그 칸에 멈춰 선 뒤, 다음 이동으로 한 칸이라도
// 더 나가야 비로소 완주(finished)한다. 그래서 바깥길의 마지막 유효 칸이 19에서 20으로
// 늘었다 — 20은 실제로 밟고 멈춰 설 수 있는 평범한 outer 칸이고(같은 이유로 업기/잡기 판정도
// 다른 칸과 동일하게 그대로 적용된다), 21 이상으로 넘어가는 순간에만 finished가 된다.
export const LAST_OUTER_INDEX = 20;

/**
 * "finish" 트랙(10번/15번 진입, 항상 완주 방향으로 나감) 경로를 "모서리를 절대값 0으로 하는
 * 7칸짜리 트랙"으로 계산한다. 0=모서리, 1~2=shortcutIn, 3=center(exitVia:"finish"), 4~5=shortcutOut,
 * 6=도착점(외곽 20번 — 정확히 도착만 하면 아직 완주 아님), 7 이상=finished.
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
  if (absoluteStep === 6) {
    return { kind: "outer", index: LAST_OUTER_INDEX };
  }
  return { kind: "finished" };
}

/**
 * "cross" 트랙(5번 진입 전용, 실제로 15번 쪽으로 건너간다) 경로 — 같은 절대값 체계를 쓰되
 * 6 이상은 finished가 아니라 외곽 15번 칸(그리고 그 이후는 평범한 바깥길)으로 이어진다.
 * docs/superpowers/specs/2026-08-24-real-diagonal-crossing-design.md §2 참고. 바깥길에
 * 합류한 뒤로는 위 LAST_OUTER_INDEX(20, 도착점) 규칙을 그대로 따른다 — 정확히 20번에
 * 도착하면 멈춰 서고, 21 이상으로 넘어가야 완주한다.
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
      // 5번에서 타서 정확히 중앙에 멈춰 선 말은 예외적으로 여기서만 선택지가 있다(2026-08-25
      // 변경, 사용자 명시 요청) — 원래 트랙(15번 방향)을 계속 타거나(useShortcut=false, 기존
      // 동작), 완주 방향 트랙으로 전환할 수 있다(useShortcut=true). shortcutIn/shortcutCross
      // 같은 지름길 중간 칸에서는 여전히 선택지가 없다(위 분기들 그대로) — 오직 "정확히
      // 중앙에 멈춰 서 있는 상태"에서 새 턴에 이어서 움직일 때만 이 선택이 생긴다.
      if (useShortcut) {
        return shortcutPositionFromAbsolute(null, 3 + steps);
      }
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

  // 정확히 도착점(20번)에 도착하면 완주가 아니라 그냥 그 칸에 멈춰 선다 — 다음 이동으로 한
  // 칸이라도 더 나가야(21 이상) 완주한다(2026-08-28 변경).
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
  { side: "D", min: 16, max: 20 },
];

/**
 * 보드를 4개의 "변"으로 나눈다(캐릭터 능력의 "같은 줄" 판정용). outer가 아닌 모든 위치
 * (start/center/finished/shortcutIn/shortcutOut/shortcutCross)는 어느 변에도 속하지 않는다.
 * 20번(도착점)은 기존 5/10/15번 모서리와 같은 맥락으로 그 변(D)에 포함시킨다 — 물리적으로
 * 도착점 칸이지만 완주 전까지는(2026-08-28 변경) 평범한 outer 칸과 동일하게 취급한다.
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
