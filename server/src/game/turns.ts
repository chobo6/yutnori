import { GRANTS_EXTRA_THROW, type YutResult } from "./gauge";
import type { Piece } from "./pieces";

export function buildTurnOrder(teamAIds: [string, string], teamBIds: [string, string]): string[] {
  return [teamAIds[0], teamBIds[0], teamAIds[1], teamBIds[1]];
}

export function nextTurnIndex(currentIndex: number, order: string[], result: YutResult): number {
  if (GRANTS_EXTRA_THROW.has(result)) {
    return currentIndex;
  }
  return (currentIndex + 1) % order.length;
}

export function checkWinner(pieces: Piece[], ownerId: string): boolean {
  const ownPieces = pieces.filter((p) => p.ownerId === ownerId);
  return ownPieces.length === 2 && ownPieces.every((p) => p.position.kind === "finished");
}
