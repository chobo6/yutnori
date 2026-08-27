export type PositionKind =
  | "start"
  | "outer"
  | "shortcutIn5"
  | "shortcutIn10"
  | "shortcutIn15"
  | "center"
  | "centerCross"
  | "shortcutOut"
  | "shortcutCross"
  | "finished";

export interface PlayerState {
  sessionId: string;
  nickname: string;
  team: "A" | "B" | "";
  ready: boolean;
  characters: string[];
}

export interface PieceState {
  id: string;
  ownerSessionId: string;
  character: string;
  positionKind: PositionKind;
  positionIndex: number;
  previousPositionKind: PositionKind;
  previousPositionIndex: number;
}

export interface PendingResultState {
  id: string;
  result: string;
  /** 이 패를 쓸 수 있는 말 id 목록 — 비어 있으면 누구나 쓸 수 있다(server/src/rooms/MatchState.ts와 동일). */
  restrictedToPieceIds: string[];
}

export interface MatchState {
  phase: "waiting" | "playing" | "finished";
  mode: "2v2" | "1v1";
  players: Map<string, PlayerState>;
  pieces: PieceState[];
  turnOrder: string[];
  currentTurnIndex: number;
  gaugePhase: "idle" | "charging" | "resolved";
  throwStartAt: number;
  lastThrowResult: string;
  pendingResults: PendingResultState[];
  turnDeadlineAt: number;
  winnerSessionId: string;
}

export const CHARACTERS = ["교주", "성직", "마담", "의사"] as const;
export type CharacterId = (typeof CHARACTERS)[number];

// server/src/game/gauge.ts의 GYOJU_BONUS_RESULT와 동일 — 모서리에서 발동한 교주 보너스가
// 즉시 적용되지 않고 지름길 선택을 기다리는 합성 대기 패의 result 코드.
export const GYOJU_BONUS_RESULT = "gyojuBonus";

// server/src/game/gauge.ts의 YutResult(6개) + GYOJU_BONUS_RESULT와 동일한 라벨.
export const YUT_RESULT_LABELS: Record<string, string> = {
  backDo: "빽도",
  do: "도",
  gae: "개",
  geol: "걸",
  yut: "윷",
  mo: "모",
  [GYOJU_BONUS_RESULT]: "교주 보너스",
};

// server/src/game/gauge.ts의 YUT_STEPS와 동일 — 이동 가능 칸(도착지) 미리보기 계산에 필요.
export const YUT_STEPS: Record<string, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
  [GYOJU_BONUS_RESULT]: 1,
};

// server/src/game/position.ts의 SHORTCUT_JUNCTIONS(5, 10)와 동일 — 15번은 2026-08-27에
// 지름길 후보에서 제외됐다(완주에서 오히려 손해라 선택지 자체를 없앰).
export const SHORTCUT_JUNCTION_INDICES = new Set([5, 10]);
