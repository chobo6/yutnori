import { LAST_OUTER_INDEX, moveBackward, moveForward, type Position } from "./position";

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
  if (a.kind === "center" && b.kind === "center") return true; // exitVia는 물리적 위치와 무관 — 비교하지 않는다
  if (a.kind === "shortcutIn" && b.kind === "shortcutIn") return a.junction === b.junction && a.step === b.step;
  if (a.kind === "shortcutOut" && b.kind === "shortcutOut") return a.step === b.step;
  if (a.kind === "shortcutCross" && b.kind === "shortcutCross") return a.step === b.step;
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

  // 빽도(-1)는 "직전 이동 전체를 되돌리기"가 아니라 REQUIREMENTS.md §7의 "-1칸"이어야 한다.
  // steps가 2 이상인 이동 뒤에 previousPosition을 그냥 fromPosition(이동 시작 전 칸)으로
  // 두면, 빽도가 그 이동 전체 칸수만큼(예: 개=2칸) 뒤로 가버리는 버그가 생긴다(2026-08-28
  // 발견). "착지 1칸 전" 위치를 moveForward로 다시 계산해서 저장해야 정확히 1칸만 되돌아간다
  // — moveForward가 이미 지름길/중앙 등 트랙 분기를 다 알고 있으므로 별도의 역방향 계산
  // 함수 없이 재사용할 수 있다. steps가 1이면 "착지 1칸 전"이 곧 fromPosition이라 그대로 둔다.
  // 다만 fromPosition이 "start"(대기 중이던 말이 이번 던지기로 막 나온 경우)라면 예외다 —
  // 보드는 시작점과 도착점이 물리적으로 같은 모서리를 도는 순환 트랙이라(도착점은 정확히
  // 도착만 해서는 완주가 아니라 한 칸 더 나가야 하는 평범한 outer 칸으로 이미 취급 중,
  // position.ts LAST_OUTER_INDEX 참고), "도" 한 칸 전은 대기 상태가 아니라 그 도착점(외곽
  // 20번) 칸이다. 이렇게 안 하면 도 자리에서 빽도를 맞았을 때 판 위 칸(도착점)이 아니라
  // 완전히 대기 상태로 돌아가버려, 도착점에 있던 말과 잡기/업기 상호작용도 전혀 없이 그냥
  // 사라지는 것처럼 보이는 버그가 생긴다(2026-08-30 발견).
  // (알려진 한계: 이 이동 자체가 빽도(steps===-1)인 경우는 대상에서 뺐다 — 같은 말이 연속으로
  // 두 번 빽도를 맞는 극히 드문 경우, 두 번째 빽도는 여전히 fromPosition으로 돌아간다.)
  const newPreviousPosition =
    steps >= 2
      ? moveForward(fromPosition, steps - 1, useShortcut)
      : fromPosition.kind === "start"
        ? ({ kind: "outer", index: LAST_OUTER_INDEX } as const)
        : fromPosition;

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
      return { ...p, position: newPosition, previousPosition: newPreviousPosition };
    }
    if (capturedSet.has(p.id)) {
      return { ...p, position: { kind: "start" as const }, previousPosition: p.position };
    }
    return p;
  });

  return { pieces: result, capturedPieceIds, piggybackedIds: Array.from(piggybackIds) };
}
