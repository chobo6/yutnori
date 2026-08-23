// client/src/game/cornerSlots.ts
import type { MatchState } from "./matchTypes";

export type CornerKey = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/**
 * 2v2: 같은 팀은 서로 마주보는 대각선에 배치 — A팀=좌상단·우하단, B팀=우상단·좌하단.
 * 1v1: 마주보는 두 모서리(좌상단·우하단)만 사용, turnOrder 순서대로.
 * 같은 팀 안에서 둘 중 누가 어느 모서리인지는 turnOrder에서 먼저 나오는 쪽이 먼저 나열한 모서리를 가져간다.
 */
export function assignCorners(state: MatchState): Record<CornerKey, string | null> {
  const order = state.turnOrder;

  if (state.mode === "1v1") {
    return {
      topLeft: order[0] ?? null,
      topRight: null,
      bottomLeft: null,
      bottomRight: order[1] ?? null,
    };
  }

  const teamA = order.filter((id) => state.players.get(id)?.team === "A");
  const teamB = order.filter((id) => state.players.get(id)?.team === "B");

  return {
    topLeft: teamA[0] ?? null,
    bottomRight: teamA[1] ?? null,
    topRight: teamB[0] ?? null,
    bottomLeft: teamB[1] ?? null,
  };
}
