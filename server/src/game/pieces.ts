import { moveBackward, moveForward, type Position } from "./position";

export type PieceId = string;

export interface Piece {
  id: PieceId;
  ownerId: string;
  /** 소속 팀 ("A" | "B"). 잡기는 팀 기준, 업기는 주인 기준으로 판정한다 (REQUIREMENTS.md §6). */
  teamId: string;
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  character: string;
  position: Position;
  previousPosition: Position;
}

export interface MoveResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
  /** 이번 이동으로 함께 움직인(업힌) 같은 주인의 다른 말 id들. 교주 능력 판정에 쓰인다(abilities.ts). */
  piggybackedIds: PieceId[];
}

export function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  return false;
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

  // 도착 칸에 있던 상대 "팀" 말 (잡기 대상) — 같은 팀 동료의 말은 잡지 않는다 (REQUIREMENTS.md §6)
  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.teamId !== mover.teamId && samePosition(p.position, newPosition) && newPosition.kind !== "start" && newPosition.kind !== "finished")
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

  return { pieces: result, capturedPieceIds, piggybackedIds: Array.from(piggybackIds) };
}
