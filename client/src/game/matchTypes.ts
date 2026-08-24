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

// server/src/game/gauge.ts의 YutResult와 동일한 6개 코드.
export const YUT_RESULT_LABELS: Record<string, string> = {
  backDo: "빽도",
  do: "도",
  gae: "개",
  geol: "걸",
  yut: "윷",
  mo: "모",
};

// server/src/game/gauge.ts의 YUT_STEPS와 동일 — 이동 가능 칸(도착지) 미리보기 계산에 필요.
export const YUT_STEPS: Record<string, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};

// server/src/game/position.ts의 SHORTCUT_JUNCTIONS(5, 10, 15)와 동일.
export const SHORTCUT_JUNCTION_INDICES = new Set([5, 10, 15]);
