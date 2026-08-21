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
