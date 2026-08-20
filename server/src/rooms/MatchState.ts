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
  @type("string") positionKind: string = "start"; // "start" | "outer" | "center" | "finished"
  @type("number") positionIndex: number = -1;
  @type("string") previousPositionKind: string = "start";
  @type("number") previousPositionIndex: number = -1;
}

export class MatchState extends Schema {
  @type("string") phase: string = "waiting"; // "waiting" | "playing" | "finished"
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type([PieceSchema]) pieces = new ArraySchema<PieceSchema>();
  @type(["string"]) turnOrder = new ArraySchema<string>();
  @type("number") currentTurnIndex: number = 0;
  @type("string") gaugePhase: string = "idle"; // "idle" | "charging"
  @type("number") throwStartAt: number = 0;
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
