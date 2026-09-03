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
 * subjectPosition과 같은 줄에 있는 상대(abilityOwnerTeamId 기준 적팀)의 마담이 하나라도 저지에
 * 성공하면 그 마담의 pieceId를 반환(UI 알림용), 아니면 null. 마담이 여럿이면 각각 독립적으로
 * 판정하고, 하나라도 성공하면 즉시 저지된다.
 *
 * subjectPosition은 "능력을 발동하는 말 자신의 위치"다(2026-09-04 확정, 사용자 정정 — 이전엔
 * 의사/성직 판정에서 이 자리에 잡힌 말의 잡히기 직전 위치를 넘겼다). 교주는 이동한 말 자신이
 * 곧 능력의 주체라 도착 칸을 그대로 넘기면 되지만, 성직은 잡힌 말과 다른 줄에서도 발동할 수
 * 있어서(의사와 달리 "같은 줄" 제약이 없음) 잡힘 사건 위치를 기준으로 비교하면 성직과 전혀
 * 무관한 줄에 있는 마담이 저지해버리는 버그가 있었다 — 의사는 애초에 잡힌 말과 같은 줄에
 * 있어야 후보가 되므로 이 변경으로 실질 동작이 안 바뀐다.
 */
function isBlockedByMadam(pieces: Piece[], abilityOwnerTeamId: string, subjectPosition: Position, rng: Rng): PieceId | null {
  const enemyMadams = pieces.filter(
    (p) => p.character === "마담" && p.teamId !== "" && p.teamId !== abilityOwnerTeamId && onBoard(p.position),
  );
  for (const madam of enemyMadams) {
    if (sameSide(madam.position, subjectPosition) && roll(MADAM_BLOCK_CHANCE, rng)) {
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

/**
 * 후보 p가 "판 위에 있다"고 볼 수 있는지 판단한다 — 보통은 현재 위치가 onBoard면 그만이지만,
 * 업기로 같은 칸에 있다가 이번 이동으로 한꺼번에 잡힌 다른 그룹의 말(siblingCaptures 안의
 * 다른 CaptureRecord)은 이미 대기 상태(start)로 옮겨진 뒤라 onBoard가 거짓이 된다 — 그
 * 자신이 속한 그룹은 스스로를 구하지 못하지만(호출부에서 그룹 멤버를 후보에서 제외),
 * 이미 다른 그룹으로 처리가 끝나 판 위로 복원된 경우까지 막히면 안 된다(요청자 확정,
 * 2026-08-30). 그래서 p가 어느 그룹의 캡처 기록에 해당하는 것으로 확인되면, "잡히기 직전"
 * 위치(그 CaptureRecord.originalPosition)를 대신 판정 기준으로 쓴다 — 이미 앞선 그룹
 * 처리에서 의사/성직에 의해 복원/리다이렉트되어 실제로 판 위로 돌아온 경우는
 * onBoard(p.position)가 먼저 참이 되어 그 최신 위치를 그대로 쓴다.
 */
function eligiblePosition(p: Piece, siblingCaptures: CaptureRecord[]): Position | null {
  if (onBoard(p.position)) return p.position;
  const sibling = siblingCaptures.find((c) => c.pieceId === p.id);
  return sibling ? sibling.originalPosition : null;
}

/**
 * 잡힘 이벤트들을 "같은 칸에서 한꺼번에 잡힌 그룹" 단위로 묶는다 — 업기 스택이 통째로
 * 잡히면 originalPosition이 전부 동일하므로, 이 값이 같은 CaptureRecord들을 하나의 그룹으로
 * 취급한다(2026-08-30 변경). 그룹 안의 각 말은 previousPosition만 서로 다를 수 있고
 * (originalPreviousPosition), 위치 자체는 같다. 처음 등장한 순서를 그대로 유지한다.
 */
function groupCapturesByPosition(captures: CaptureRecord[]): CaptureRecord[][] {
  const groups: CaptureRecord[][] = [];
  for (const capture of captures) {
    const existing = groups.find((g) => samePosition(g[0].originalPosition, capture.originalPosition));
    if (existing) existing.push(capture);
    else groups.push([capture]);
  }
  return groups;
}

function tryUisa(pieces: Piece[], group: CaptureRecord[], siblingCaptures: CaptureRecord[], rng: Rng): TryResponseResult {
  const groupIds = new Set(group.map((c) => c.pieceId));
  const teamId = group[0].teamId;
  const originalPosition = group[0].originalPosition;
  const candidates = pieces.filter((p) => {
    if (p.character !== "의사" || p.teamId !== teamId || groupIds.has(p.id)) return false;
    const position = eligiblePosition(p, siblingCaptures);
    return position !== null && sameSide(position, originalPosition);
  });
  let blockedBy: PieceId | null = null;
  for (const uisa of candidates) {
    // 마담은 잡힌 말의 위치가 아니라 의사 자신의 위치와 같은 줄에 있어야 저지할 수 있다(위
    // isBlockedByMadam 문서 참고) — non-null 단정은 candidates 필터에서 이미 확인했으므로 안전.
    const uisaPosition = eligiblePosition(uisa, siblingCaptures)!;
    const blocker = isBlockedByMadam(pieces, teamId, uisaPosition, rng);
    if (blocker) {
      blockedBy = blocker;
      continue;
    }
    if (roll(UISA_CHANCE, rng)) {
      // 그룹 전체가 하나의 확률로 다같이 산다(2026-08-30) — 겹쳐서(업기) 한꺼번에 잡힌
      // 말들에게 각자 독립적으로 35%를 따로 적용하면 일부만 살아남는 어색한 결과가 나온다.
      const result = pieces.map((p) => {
        const capture = group.find((c) => c.pieceId === p.id);
        return capture ? { ...p, position: capture.originalPosition, previousPosition: capture.originalPreviousPosition } : p;
      });
      return { pieces: result, blockedBy: null };
    }
  }
  return { pieces: null, blockedBy };
}

function trySeongjik(
  pieces: Piece[],
  group: CaptureRecord[],
  siblingCaptures: CaptureRecord[],
  rng: Rng,
): TryResponseResult & { redirectedTo: PieceId | null } {
  const groupIds = new Set(group.map((c) => c.pieceId));
  const teamId = group[0].teamId;
  const candidates = pieces.filter(
    (p) => p.character === "성직" && p.teamId === teamId && !groupIds.has(p.id) && eligiblePosition(p, siblingCaptures) !== null,
  );
  let blockedBy: PieceId | null = null;
  for (const seongjik of candidates) {
    // 성직 후보 자신이 다른 그룹으로 함께 잡혀 이미 대기 상태(start)로 옮겨진 경우, 순간이동
    // 목적지는 그 성직의 "현재"(start) 위치가 아니라 잡히기 직전 위치여야 한다 — 그렇지
    // 않으면 판 밖으로 순간이동시키는 무의미한 결과가 나온다. non-null 단정은 candidates
    // 필터에서 이미 확인했으므로 안전.
    const seongjikPosition = eligiblePosition(seongjik, siblingCaptures)!;
    // 마담은 잡힌 말의 위치가 아니라 성직 자신의 위치와 같은 줄에 있어야 저지할 수 있다(위
    // isBlockedByMadam 문서 참고).
    const blocker = isBlockedByMadam(pieces, teamId, seongjikPosition, rng);
    if (blocker) {
      blockedBy = blocker;
      continue;
    }
    if (roll(SEONGJIK_CHANCE, rng)) {
      // 그룹 전체가 성직의 위치로 함께 순간이동한다(2026-08-30) — 개별 확률이 아니라 그룹
      // 하나에 하나의 판정.
      const result = pieces.map((p) =>
        groupIds.has(p.id) ? { ...p, position: seongjikPosition, previousPosition: seongjikPosition } : p,
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

function resolveOneGroup(
  pieces: Piece[],
  group: CaptureRecord[],
  siblingCaptures: CaptureRecord[],
  rng: Rng,
): { pieces: Piece[]; effects: CaptureEffect[] } {
  const uisaAttempt = tryUisa(pieces, group, siblingCaptures, rng);
  if (uisaAttempt.pieces) {
    return {
      pieces: uisaAttempt.pieces,
      effects: group.map((c) => ({ pieceId: c.pieceId, negated: true, redirectedTo: null, blockedBy: null })),
    };
  }

  const seongjikAttempt = trySeongjik(pieces, group, siblingCaptures, rng);
  if (seongjikAttempt.pieces) {
    return {
      pieces: seongjikAttempt.pieces,
      effects: group.map((c) => ({
        pieceId: c.pieceId,
        negated: false,
        redirectedTo: seongjikAttempt.redirectedTo,
        blockedBy: null,
      })),
    };
  }

  const blockedBy = uisaAttempt.blockedBy ?? seongjikAttempt.blockedBy;
  return {
    pieces,
    effects: group.map((c) => ({ pieceId: c.pieceId, negated: false, redirectedTo: null, blockedBy })),
  };
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
 * 같은 칸에서 한꺼번에 잡힌(업기 스택) 말들은 originalPosition이 같으므로 하나의 그룹으로
 * 묶여 단 한 번의 확률 판정으로 다같이 살거나 다같이 잡힌다(2026-08-30 변경, 요청자 확정 —
 * 예전엔 겹쳐 잡힌 말 각각에 독립적으로 확률을 적용해 일부만 부활하는 결과가 나왔다).
 * captures 전체를 각 그룹 시도에 "다른 그룹으로 함께 잡힌 말" 정보로 넘긴다 — 업기로 겹쳐
 * 있다가 한꺼번에 잡힌 말들은 서로 다른 그룹을 구할 후보가 될 수 있어야 하기 때문이다
 * (자기 그룹 멤버만 예외, tryUisa/trySeongjik의 groupIds.has(p.id) 조건).
 */
export function resolveCaptureResponses(pieces: Piece[], captures: CaptureRecord[], rng: Rng): CaptureResponseResult {
  const groups = groupCapturesByPosition(captures);
  let result = pieces;
  const negatedPieceIds: PieceId[] = [];
  const effects: CaptureEffect[] = [];
  for (const group of groups) {
    const outcome = resolveOneGroup(result, group, captures, rng);
    result = outcome.pieces;
    for (const effect of outcome.effects) {
      effects.push(effect);
      if (effect.negated) negatedPieceIds.push(effect.pieceId);
    }
  }
  return { pieces: result, negatedPieceIds, effects };
}

/** 캡처 목록 중 하나라도 의사에게 무효화되지 않고 살아남았으면 true — 잡기 보너스 던지기 지급 여부 판정에 쓴다. */
export function hasEffectiveCapture(captureRecords: CaptureRecord[], negatedPieceIds: PieceId[]): boolean {
  return captureRecords.some((c) => !negatedPieceIds.includes(c.pieceId));
}
