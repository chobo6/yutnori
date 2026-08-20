import { moveBackward, moveForward, type Position } from "./position";

export type PieceId = string;

export interface Piece {
  id: PieceId;
  ownerId: string;
  position: Position;
  previousPosition: Position;
}

export interface MoveResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
}

function samePosition(a: Position, b: Position): boolean {
  if (a.kind === "outer" && b.kind === "outer") return a.index === b.index;
  if (a.kind === "center" && b.kind === "center") return true;
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

  // 도착 칸에 있던 상대 말 (잡기 대상) — 새 위치가 outer일 때만 의미 있음
  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.ownerId !== mover.ownerId && samePosition(p.position, newPosition) && newPosition.kind !== "start" && newPosition.kind !== "finished")
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

  return { pieces: result, capturedPieceIds };
}
