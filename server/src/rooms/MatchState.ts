import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { Position } from "../game/position";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") nickname: string = "";
  @type("string") team: string = ""; // "A" | "B" | ""
  @type("boolean") ready: boolean = false;
  @type(["string"]) characters = new ArraySchema<string>();
}

export class PieceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerSessionId: string = "";
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  @type("string") character: string = "";
  // "start" | "outer" | "shortcutIn5" | "shortcutIn10" | "shortcutIn15" | "center" | "shortcutOut" | "finished"
  @type("string") positionKind: string = "start";
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
}

export class PendingResultSchema extends Schema {
  /** 서버 발급 안정 id — 같은 결과(예: "개")가 중복 쌓여도 클라이언트가 특정 항목을 지정할 수 있게 함. */
  @type("string") id: string = "";
  /** YutResult 코드("mo"|"yut"|"geol"|"gae"|"do"|"backDo"). */
  @type("string") result: string = "";
}

export class MatchState extends Schema {
  @type("string") phase: string = "waiting"; // "waiting" | "playing" | "finished"
  @type("string") mode: string = "2v2"; // "2v2" | "1v1"
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([PieceSchema]) pieces = new ArraySchema<PieceSchema>();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("number") currentTurnIndex: number = 0;
  @type("string") gaugePhase: string = "idle"; // "idle" | "charging" | "resolved"
  @type("number") throwStartAt: number = 0;
  /** 직전 던지기 결과(YutResult). 아직 던지지 않았거나 이동을 마쳐 소진되면 "". */
  @type("string") lastThrowResult: string = "";
  /** 아직 소진하지 않은 던지기 결과들 — 윷/모 연속 던지기나 잡기 보너스로 여러 개 쌓일 수 있다. */
  @type([PendingResultSchema]) pendingResults = new ArraySchema<PendingResultSchema>();
  /** 현재 턴(던지기 또는 말 선택) 제한시간이 끝나는 절대 시각(ms epoch). 활성 제한이 없으면 0. */
  @type("number") turnDeadlineAt: number = 0;
  @type("string") winnerSessionId: string = "";
}

export function toSchemaPosition(pos: Position): { kind: string; index: number } {
  if (pos.kind === "outer") {
    return { kind: "outer", index: pos.index };
  }
  if (pos.kind === "shortcutIn") {
    return { kind: `shortcutIn${pos.junction}`, index: pos.step };
  }
  if (pos.kind === "shortcutOut") {
    return { kind: "shortcutOut", index: pos.step };
  }
  return { kind: pos.kind, index: -1 };
}

export function fromSchemaPosition(kind: string, index: number): Position {
  if (kind === "outer") {
    return { kind: "outer", index };
  }
  if (kind === "shortcutIn5" || kind === "shortcutIn10" || kind === "shortcutIn15") {
    const junction = Number(kind.slice("shortcutIn".length)) as 5 | 10 | 15;
    return { kind: "shortcutIn", junction, step: index as 1 | 2 };
  }
  if (kind === "shortcutOut") {
    return { kind: "shortcutOut", step: index as 1 | 2 };
  }
  return { kind: kind as "start" | "center" | "finished" };
}
