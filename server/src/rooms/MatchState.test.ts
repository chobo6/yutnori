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

  it("start/finished는 index -1로 저장되고 복원된다", () => {
    for (const kind of ["start", "finished"] as const) {
      const schema = toSchemaPosition({ kind });
      expect(schema.index).toBe(-1);
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual({ kind });
    }
  });

  it("center(exitVia=finish)는 'center' kind 문자열로, exitVia=cross는 'centerCross'로 왕복 변환된다", () => {
    const finish = toSchemaPosition({ kind: "center", exitVia: "finish" });
    expect(finish).toEqual({ kind: "center", index: -1 });
    expect(fromSchemaPosition(finish.kind, finish.index)).toEqual({ kind: "center", exitVia: "finish" });

    const cross = toSchemaPosition({ kind: "center", exitVia: "cross" });
    expect(cross).toEqual({ kind: "centerCross", index: -1 });
    expect(fromSchemaPosition(cross.kind, cross.index)).toEqual({ kind: "center", exitVia: "cross" });
  });

  it("shortcutCross는 왕복 변환된다", () => {
    for (const step of [1, 2] as const) {
      const position = { kind: "shortcutCross" as const, step };
      const schema = toSchemaPosition(position);
      expect(schema).toEqual({ kind: "shortcutCross", index: step });
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
    }
  });

  it("shortcutIn은 진입 모서리별로 다른 kind 문자열로 저장되고 왕복 변환된다", () => {
    for (const junction of [5, 10, 15] as const) {
      for (const step of [1, 2] as const) {
        const position = { kind: "shortcutIn" as const, junction, step };
        const schema = toSchemaPosition(position);
        expect(schema).toEqual({ kind: `shortcutIn${junction}`, index: step });
        expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
      }
    }
  });

  it("shortcutOut은 왕복 변환된다", () => {
    for (const step of [1, 2] as const) {
      const position = { kind: "shortcutOut" as const, step };
      const schema = toSchemaPosition(position);
      expect(schema).toEqual({ kind: "shortcutOut", index: step });
      expect(fromSchemaPosition(schema.kind, schema.index)).toEqual(position);
    }
  });
});
