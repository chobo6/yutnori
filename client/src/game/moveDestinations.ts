import { positionToCoords, type Coords } from "./boardCoords";
import { SHORTCUT_JUNCTION_INDICES, YUT_STEPS, type PendingResultState, type PieceState } from "./matchTypes";
import { computeMovePath } from "./movePath";

export interface MoveDestination {
  resultId: string;
  useShortcut: boolean;
  coords: Coords;
}

/**
 * 선택된 말이 쌓인 패 각각으로 갈 수 있는 모든 도착 칸을 계산한다 — 보드 위 파란 점으로
 * 표시할 좌표 목록이다. 지름길 모서리(5/10/15)에 있는 말은 같은 패라도 지름길 사용/미사용
 * 두 가지 도착 칸이 나올 수 있어 둘 다 포함한다. 실제 이동 판정은 항상 서버(movePiece
 * 메시지 처리)가 하고, 여기 계산은 "어느 점을 누르면 어느 패/지름길 여부로 이동하는지"
 * 보여주는 시각 힌트일 뿐이다 — movePath.ts(서버 position.ts 미러링)를 그대로 재사용한다.
 */
export function computeMoveDestinations(
  piece: PieceState,
  pendingResults: PendingResultState[],
): MoveDestination[] {
  const destinations: MoveDestination[] = [];
  const atJunction = piece.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(piece.positionIndex);

  for (const result of pendingResults) {
    const steps = YUT_STEPS[result.result];
    if (steps === undefined) continue;

    if (steps < 0) {
      // 빽도 — previousPosition으로 직행, 지름길 개념 없음.
      const coords = positionToCoords(piece.previousPositionKind, piece.previousPositionIndex);
      if (coords) destinations.push({ resultId: result.id, useShortcut: false, coords });
      continue;
    }

    for (const useShortcut of atJunction ? [false, true] : [false]) {
      const path = computeMovePath({ kind: piece.positionKind, index: piece.positionIndex }, steps, useShortcut);
      const last = path[path.length - 1];
      if (!last) continue;
      const coords = positionToCoords(last.kind, last.index);
      if (coords) destinations.push({ resultId: result.id, useShortcut, coords });
    }
  }

  return destinations;
}
