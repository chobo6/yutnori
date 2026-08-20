// server/src/rooms/MatchState.test.ts
import { describe, expect, it } from "vitest";
import { fromSchemaPosition, MatchState, PieceSchema, PlayerState, toSchemaPosition } from "./MatchState";

describe("MatchState 스키마", () => {
  it("초기 상태는 waiting phase, 빈 players/pieces를 가진다", () => {
    const state = new MatchState();
    expect(state.phase).toBe("waiting");
    expect(state.players.size).toBe(0);
    expect(state.pieces.length).toBe(0);
  });

  it("PlayerState를 players 맵에 추가할 수 있다", () => {
    const state = new MatchState();
    const player = new PlayerState();
    player.sessionId = "s1";
    state.players.set("s1", player);
    expect(state.players.get("s1")?.sessionId).toBe("s1");
  });
});

describe("Position <-> Schema 변환", () => {
  it("outer 위치를 왕복 변환해도 값이 보존된다", () => {
    const schema = toSchemaPosition({ kind: "outer", index: 7 });
    expect(schema).toEqual({ kind: "outer", index: 7 });
    expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind: "outer", index: 7 });
  });

  it("start/center/finished는 index -1로 저장되고 복원된다", () => {
    for (const kind of ["start", "center", "finished"] as const) {
      const schema = toSchemaPosition({ kind });
      expect(schema.index).toBe(-1);
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind });
    }
  });
});
