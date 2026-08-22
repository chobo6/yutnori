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
