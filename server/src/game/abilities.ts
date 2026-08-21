import { moveForward, sameSide, type Position } from "./position";
import { samePosition, type Piece, type PieceId } from "./pieces";

/** [0, 1) 범위의 난수를 반환하는 함수. 테스트에서 결정적 값을 주입하기 위한 타입. */
export type Rng = () => number;

export const GYOJU_CHANCE = 0.8;
export const SEONGJIK_CHANCE = 0.4;
export const MADAM_BLOCK_CHANCE = 0.6;
export const UISA_CHANCE = 0.35;

/** 잡힘 이벤트 1건 — 의사/성직/마담 판정에 필요한 정보. */
export interface CaptureRecord {
  pieceId: PieceId;
  /** 잡힌 말의 소속 팀 — 이 팀의 의사/성직이 반응 후보가 된다. */
  teamId: string;
  /** 잡히기 직전 위치 — 의사의 "같은 줄" 판정 기준이자, 무효화 시 복원할 좌표. */
  originalPosition: Position;
  /** 잡히기 직전(이번 캡처 이전) previousPosition — 복원/순간이동 후 빽도 판정이 올바른 칸을 참조하도록 함께 갱신한다. */
  originalPreviousPosition: Position;
}

export interface GyojuBonusResult {
  pieces: Piece[];
  capturedPieceIds: PieceId[];
}

function roll(chance: number, rng: Rng): boolean {
  return rng() < chance;
}

function onBoard(position: Position): boolean {
  return position.kind === "outer" || position.kind === "center";
}

/**
 * eventPosition과 같은 줄에 있는 상대(abilityOwnerTeamId 기준 적팀)의 마담이 하나라도 저지에
 * 성공하면 true. 마담이 여럿이면 각각 독립적으로 판정하고, 하나라도 성공하면 즉시 저지된다.
 */
function isBlockedByMadam(pieces: Piece[], abilityOwnerTeamId: string, eventPosition: Position, rng: Rng): boolean {
  const enemyMadams = pieces.filter(
    (p) => p.character === "마담" && p.teamId !== "" && p.teamId !== abilityOwnerTeamId && onBoard(p.position),
  );
  for (const madam of enemyMadams) {
    if (sameSide(madam.position, eventPosition) && roll(MADAM_BLOCK_CHANCE, rng)) {
      return true;
    }
  }
  return false;
}

/**
 * 교주 능력(스펙 §3.1): 이번 턴에 이동한 말이 교주이고 업기가 발생했다면, 80% 확률로 업힌
 * 말 전원이 1칸 추가 전진한다. 보너스 전진 칸에 상대 말이 있으면 정상적으로 잡는다.
 * 이 함수 자체는 재귀적으로 다시 호출되지 않는다(1회성) — 호출부(MatchRoom)가 보장한다.
 */
export function applyGyojuBonus(
  pieces: Piece[],
  moverId: PieceId,
  piggybackedIds: PieceId[],
  rng: Rng,
): GyojuBonusResult {
  const mover = pieces.find((p) => p.id === moverId);
  if (!mover || mover.character !== "교주" || piggybackedIds.length === 0 || !onBoard(mover.position)) {
    return { pieces, capturedPieceIds: [] };
  }

  if (isBlockedByMadam(pieces, mover.teamId, mover.position, rng)) {
    return { pieces, capturedPieceIds: [] };
  }

  if (!roll(GYOJU_CHANCE, rng)) {
    return { pieces, capturedPieceIds: [] };
  }

  const groupIds = new Set([moverId, ...piggybackedIds]);
  const newPosition = moveForward(mover.position, 1, false);

  const capturedPieceIds: PieceId[] = pieces
    .filter((p) => p.teamId !== mover.teamId && !groupIds.has(p.id) && samePosition(p.position, newPosition))
    .map((p) => p.id);
  const capturedSet = new Set(capturedPieceIds);

  const result = pieces.map((p) => {
    if (groupIds.has(p.id)) {
      return { ...p, position: newPosition, previousPosition: p.position };
    }
    if (capturedSet.has(p.id)) {
      return { ...p, position: { kind: "start" as const }, previousPosition: p.position };
    }
    return p;
  });

  return { pieces: result, capturedPieceIds };
}

function tryUisa(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] | null {
  const candidates = pieces.filter(
    (p) =>
      p.character === "의사" &&
      p.teamId === capture.teamId &&
      p.id !== capture.pieceId &&
      onBoard(p.position) &&
      sameSide(p.position, capture.originalPosition),
  );
  for (const uisa of candidates) {
    if (isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng)) continue;
    if (roll(UISA_CHANCE, rng)) {
      return pieces.map((p) =>
        p.id === capture.pieceId
          ? { ...p, position: capture.originalPosition, previousPosition: capture.originalPreviousPosition }
          : p,
      );
    }
  }
  return null;
}

function trySeongjik(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] | null {
  const candidates = pieces.filter(
    (p) => p.character === "성직" && p.teamId === capture.teamId && p.id !== capture.pieceId && onBoard(p.position),
  );
  for (const seongjik of candidates) {
    if (isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng)) continue;
    if (roll(SEONGJIK_CHANCE, rng)) {
      return pieces.map((p) =>
        p.id === capture.pieceId ? { ...p, position: seongjik.position, previousPosition: seongjik.position } : p,
      );
    }
  }
  return null;
}

function resolveOneCapture(pieces: Piece[], capture: CaptureRecord, rng: Rng): Piece[] {
  const restored = tryUisa(pieces, capture, rng);
  if (restored) return restored;

  const redirected = trySeongjik(pieces, capture, rng);
  if (redirected) return redirected;

  return pieces;
}

/**
 * 잡힘 이벤트들을 스펙 §4 순서(의사 우선 -> 실패 시 성직)로 처리한다. captures 배열은
 * "발생 순서대로" 전달되어야 한다(원래 이동의 잡힘 -> 교주 보너스 전진의 잡힘 순).
 */
export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): Piece[] {
  let result = pieces;
  for (const capture of captures) {
    result = resolveOneCapture(result, capture, rng);
  }
  return result;
}
