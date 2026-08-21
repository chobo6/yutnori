import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";
import type { Position } from "../game/position";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") team: string = ""; // "A" | "B" | ""
  @type("boolean") ready: boolean = false;
  @type(["string"]) characters = new ArraySchema<string>();
}

export class PieceSchema extends Schema {
  @type("string") id: string = "";
  @type("string") ownerSessionId: string = "";
  /** 이 말에 고정 배정된 캐릭터("교주"|"성직"|"마담"|"의사") — 능력 판정은 abilities.ts 참고. */
  @type("string") character: string = "";
  @type("string") positionKind: string = "start"; // "start" | "outer" | "center" | "finished"
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
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
  /** 현재 턴(던지기 또는 말 선택) 제한시간이 끝나는 절대 시각(ms epoch). 활성 제한이 없으면 0. */
  @type("number") turnDeadlineAt: number = 0;
  @type("string") winnerSessionId: string = "";
}

export function toSchemaPosition(pos: Position): { kind: string; index: number } {
  if (pos.kind === "outer") {
    return { kind: "outer", index: pos.index };
  }
  return { kind: pos.kind, index: -1 };
}

export function fromSchemaPosition(kind: string, index: number): Position {
  if (kind === "outer") {
    return { kind: "outer", index };
  }
  return { kind: kind as "start" | "center" | "finished" };
}
