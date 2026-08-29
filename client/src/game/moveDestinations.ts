import { CORNERS, positionToCoords, type Coords } from "./boardCoords";
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
  // 5번에서 타서 정확히 중앙에 멈춰 선 말(centerCross)도 모서리와 마찬가지로 선택지가 둘이다
  // (원래 트랙인 15번 방향을 계속 타거나, 도착 방향 트랙으로 전환) — movePath.ts/position.ts와
  // 동일한 2026-08-25 변경.
  const atCenterChoice = piece.positionKind === "centerCross";

  for (const result of pendingResults) {
    // 특정 말(그룹)에만 허용된 패(예: 모서리에서 발동한 교주 보너스)는 그 목록에 없는 말로는
    // 계산 자체를 하지 않는다 — 서버가 어차피 거부할 도착지를 파란 점으로 보여주면 안 된다.
    if (result.restrictedToPieceIds.length > 0 && !result.restrictedToPieceIds.includes(piece.id)) continue;
    const steps = YUT_STEPS[result.result];
    if (steps === undefined) continue;

    if (steps < 0) {
      // 빽도 — previousPosition으로 직행, 지름길 개념 없음. previousPosition이 "start"인
      // 경우(첫 줄 "도" 자리에서 온 말 — 시작 후 첫 이동은 previousPosition이 항상 start다)는
      // positionToCoords가 null을 줘서(시작점은 보드 좌표가 없음) 그냥 건너뛰면 목적지 점이
      // 아예 안 뜬다 — "완주"와 똑같은 이유로 시작/도착 모서리(CORNERS[0])에 점을 띄운다
      // (2026-08-30 발견: 이 경우 목적지가 없어 플레이어가 확정할 방법이 없었다).
      const coords =
        piece.previousPositionKind === "start"
          ? CORNERS[0]
          : positionToCoords(piece.previousPositionKind, piece.previousPositionIndex);
      if (coords) destinations.push({ resultId: result.id, useShortcut: false, coords });
      continue;
    }

    for (const useShortcut of atJunction || atCenterChoice ? [false, true] : [false]) {
      const path = computeMovePath({ kind: piece.positionKind, index: piece.positionIndex }, steps, useShortcut);
      const last = path[path.length - 1];
      if (!last) continue;
      // "finished"(완주)는 보드 밖이라 positionToCoords가 null을 준다 — 그렇다고 이 도착지를
      // 그냥 건너뛰면 완주로 이어지는 이동은 찍을 점 자체가 없어 선택할 방법이 사라진다.
      // 출발/도착 모서리(CORNERS[0]) 자리에 점을 띄워 "여기를 누르면 완주"로 쓸 수 있게 한다.
      const coords = last.kind === "finished" ? CORNERS[0] : positionToCoords(last.kind, last.index);
      if (coords) destinations.push({ resultId: result.id, useShortcut, coords });
    }
  }

  return destinations;
}
