import { GRANTS_EXTRA_THROW, type YutResult } from "./gauge";
import type { Piece } from "./pieces";

export function buildTurnOrder(teamAIds: string[], teamBIds: string[]): string[] {
  const order: string[] = [];
  for (let i = 0; i < teamAIds.length; i++) {
    order.push(teamAIds[i], teamBIds[i]);
  }
  return order;
}

export function nextTurnIndex(currentIndex: number, order: string[], result: YutResult): number {
  if (GRANTS_EXTRA_THROW.has(result)) {
    return currentIndex;
  }
  return (currentIndex + 1) % order.length;
}

export function checkWinner(pieces: Piece[], ownerId: string): boolean {
  const ownPieces = pieces.filter((p) => p.ownerId === ownerId);
  return ownPieces.length > 0 && ownPieces.every((p) => p.position.kind === "finished");
}
