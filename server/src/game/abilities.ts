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
  /** 보너스 전진이 실제로 발동했는지 — UI가 "교주 발동!" 말풍선을 띄울지 판단하는 데 쓴다. */
  fired: boolean;
  /** 발동에 성공했다면 그 교주(이동한 말 자신이거나 업혀서 함께 온 말)의 pieceId — 말풍선을 어느 말에 띄울지 판단하는 데 쓴다. */
  triggeredBy: PieceId | null;
  /** 마담에게 저지됐다면 그 마담의 pieceId — UI가 "마담 발동!" 말풍선을 띄울지 판단하는 데 쓴다. */
  blockedBy: PieceId | null;
}

function roll(chance: number, rng: Rng): boolean {
  return rng() < chance;
}

function onBoard(position: Position): boolean {
  return (
    position.kind === "outer" ||
    position.kind === "center" ||
    position.kind === "shortcutIn" ||
    position.kind === "shortcutOut" ||
    position.kind === "shortcutCross"
  );
}

/**
 * eventPosition과 같은 줄에 있는 상대(abilityOwnerTeamId 기준 적팀)의 마담이 하나라도 저지에
 * 성공하면 그 마담의 pieceId를 반환(UI 알림용), 아니면 null. 마담이 여럿이면 각각 독립적으로
 * 판정하고, 하나라도 성공하면 즉시 저지된다.
 */
function isBlockedByMadam(pieces: Piece[], abilityOwnerTeamId: string, eventPosition: Position, rng: Rng): PieceId | null {
  const enemyMadams = pieces.filter(
    (p) => p.character === "마담" && p.teamId !== "" && p.teamId !== abilityOwnerTeamId && onBoard(p.position),
  );
  for (const madam of enemyMadams) {
    if (sameSide(madam.position, eventPosition) && roll(MADAM_BLOCK_CHANCE, rng)) {
      return madam.id;
    }
  }
  return null;
}

/**
 * 교주 능력(스펙 §3.1, 2026-08-30 조건 재정리): 발동 여부는 "이번 이동으로 실제로 자리를 옮긴
 * 쪽"(이동한 말 자신 + 원래 업혀 있다가 함께 움직인 말들, `movedWithMoverIds`)에 교주가
 * 있는지로만 판단한다 — 교주가 업힌 상태로 이동했거나(교주가 `movedWithMoverIds`에 포함),
 * 교주 자신이 이동해서 다른 말에 업힌 경우(교주가 `moverId`)엔 발동 후보가 되지만, 반대로
 * 가만히 있던 교주 위로 "다른 말"이 이동해와 업힌 경우는 교주가 이동 주체가 아니므로 발동
 * 후보가 아니다(2026-08-30 이전엔 도착 칸 기준 전체 그룹으로 판정해 이 경우도 잘못 발동했음).
 * 전진/포획 대상 그룹 자체는 여전히 도착 칸에 있는 전원(`landedGroupIds` — 원래 업혀 있던
 * 말 + 도착 칸에 이미 서 있던 아군 말)이다 — 발동 "판정"만 좁아졌을 뿐, 성공 시 "누가
 * 전진하는지"는 그대로다. 업기가 발생했다면(업힌 말이 최소 1개), 80% 확률로 그룹 전원이
 * 1칸 추가 전진하고, 보너스 전진 칸에 상대 말이 있으면 정상적으로 잡는다.
 * 이 함수 자체는 재귀적으로 다시 호출되지 않는다(1회성) — 호출부(MatchRoom)가 보너스 전진의
 * 결과에 대해 이 함수를 다시 부르지 않으므로, 보너스로 이동한 그룹에 또 다른 교주가 있어도
 * 추가 발동은 일어나지 않는다.
 */
export function applyGyojuBonus(
  pieces: Piece[],
  moverId: PieceId,
  landedGroupIds: PieceId[],
  movedWithMoverIds: PieceId[],
  rng: Rng,
): GyojuBonusResult {
  const mover = pieces.find((p) => p.id === moverId);
  if (!mover || landedGroupIds.length === 0 || !onBoard(mover.position)) {
    return { pieces, capturedPieceIds: [], fired: false, triggeredBy: null, blockedBy: null };
  }

  const groupIds = new Set([moverId, ...landedGroupIds]);
  const eligibleIds = new Set([moverId, ...movedWithMoverIds]);
  const gyojuInGroup = pieces.find((p) => eligibleIds.has(p.id) && p.character === "교주");
  if (!gyojuInGroup) {
    return { pieces, capturedPieceIds: [], fired: false, triggeredBy: null, blockedBy: null };
  }

  const blockedBy = isBlockedByMadam(pieces, mover.teamId, mover.position, rng);
  if (blockedBy) {
    return { pieces, capturedPieceIds: [], fired: false, triggeredBy: null, blockedBy };
  }

  if (!roll(GYOJU_CHANCE, rng)) {
    return { pieces, capturedPieceIds: [], fired: false, triggeredBy: null, blockedBy: null };
  }

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

  return { pieces: result, capturedPieceIds, fired: true, triggeredBy: gyojuInGroup.id, blockedBy: null };
}

interface TryResponseResult {
  pieces: Piece[] | null;
  /** 응답을 시도한 후보 중 하나라도 마담에게 저지됐다면 그 마담의 pieceId(UI 알림용) — 마지막으로 저지된 후보 기준. */
  blockedBy: PieceId | null;
}

function tryUisa(pieces: Piece[], capture: CaptureRecord, rng: Rng): TryResponseResult {
  const candidates = pieces.filter(
    (p) =>
      p.character === "의사" &&
      p.teamId === capture.teamId &&
      p.id !== capture.pieceId &&
      onBoard(p.position) &&
      sameSide(p.position, capture.originalPosition),
  );
  let blockedBy: PieceId | null = null;
  for (const uisa of candidates) {
    const blocker = isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng);
    if (blocker) {
      blockedBy = blocker;
      continue;
    }
    if (roll(UISA_CHANCE, rng)) {
      const result = pieces.map((p) =>
        p.id === capture.pieceId
          ? { ...p, position: capture.originalPosition, previousPosition: capture.originalPreviousPosition }
          : p,
      );
      return { pieces: result, blockedBy: null };
    }
  }
  return { pieces: null, blockedBy };
}

function trySeongjik(pieces: Piece[], capture: CaptureRecord, rng: Rng): TryResponseResult & { redirectedTo: PieceId | null } {
  const candidates = pieces.filter(
    (p) => p.character === "성직" && p.teamId === capture.teamId && p.id !== capture.pieceId && onBoard(p.position),
  );
  let blockedBy: PieceId | null = null;
  for (const seongjik of candidates) {
    const blocker = isBlockedByMadam(pieces, capture.teamId, capture.originalPosition, rng);
    if (blocker) {
      blockedBy = blocker;
      continue;
    }
    if (roll(SEONGJIK_CHANCE, rng)) {
      const result = pieces.map((p) =>
        p.id === capture.pieceId ? { ...p, position: seongjik.position, previousPosition: seongjik.position } : p,
      );
      return { pieces: result, blockedBy: null, redirectedTo: seongjik.id };
    }
  }
  return { pieces: null, blockedBy, redirectedTo: null };
}

/** 잡힘 이벤트 1건에 대한 최종 결과 — UI가 "무슨 능력이 발동했는지" 판단하는 데 쓴다. */
export interface CaptureEffect {
  pieceId: PieceId;
  /** 의사 능력으로 원위치 복원되어 사실상 무효화됐는지. */
  negated: boolean;
  /** 성직 능력으로 리다이렉트됐다면 그 성직의 pieceId, 아니면 null. */
  redirectedTo: PieceId | null;
  /** 마담에게 저지된 응답 시도가 있었다면 그 마담의 pieceId, 아니면 null. */
  blockedBy: PieceId | null;
}

function resolveOneCapture(
  pieces: Piece[],
  capture: CaptureRecord,
  rng: Rng,
): { pieces: Piece[]; effect: CaptureEffect } {
  const uisaAttempt = tryUisa(pieces, capture, rng);
  if (uisaAttempt.pieces) {
    return {
      pieces: uisaAttempt.pieces,
      effect: { pieceId: capture.pieceId, negated: true, redirectedTo: null, blockedBy: null },
    };
  }

  const seongjikAttempt = trySeongjik(pieces, capture, rng);
  if (seongjikAttempt.pieces) {
    return {
      pieces: seongjikAttempt.pieces,
      effect: { pieceId: capture.pieceId, negated: false, redirectedTo: seongjikAttempt.redirectedTo, blockedBy: null },
    };
  }

  const blockedBy = uisaAttempt.blockedBy ?? seongjikAttempt.blockedBy;
  return { pieces, effect: { pieceId: capture.pieceId, negated: false, redirectedTo: null, blockedBy } };
}

export interface CaptureResponseResult {
  pieces: Piece[];
  /** 의사 능력으로 원위치 복원되어 "사실상 무효화"된 캡처의 pieceId 목록 — 잡기 보너스 던지기 지급 대상에서 뺀다. */
  negatedPieceIds: PieceId[];
  /** captures와 같은 순서로 대응하는 발동 내역 — UI가 능력 발동 말풍선을 띄우는 데 쓴다. */
  effects: CaptureEffect[];
}

/**
 * 잡힘 이벤트들을 스펙 §4 순서(의사 우선 -> 실패 시 성직)로 처리한다. captures 배열은
 * "발생 순서대로" 전달되어야 한다(원래 이동의 잡힘 -> 교주 보너스 전진의 잡힘 순).
 */
export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): CaptureResponseResult {
  let result = pieces;
  const negatedPieceIds: PieceId[] = [];
  const effects: CaptureEffect[] = [];
  for (const capture of captures) {
    const outcome = resolveOneCapture(result, capture, rng);
    result = outcome.pieces;
    effects.push(outcome.effect);
    if (outcome.effect.negated) negatedPieceIds.push(capture.pieceId);
  }
  return { pieces: result, negatedPieceIds, effects };
}

/** 캡처 목록 중 하나라도 의사에게 무효화되지 않고 살아남았으면 true — 잡기 보너스 던지기 지급 여부 판정에 쓴다. */
export function hasEffectiveCapture(captureRecords: CaptureRecord[], negatedPieceIds: PieceId[]): boolean {
  return captureRecords.some((c) => !negatedPieceIds.includes(c.pieceId));
}
