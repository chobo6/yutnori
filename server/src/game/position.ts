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
