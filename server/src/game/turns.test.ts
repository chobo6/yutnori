import { describe, expect, it } from "vitest";
import { buildTurnOrder, checkWinner, nextTurnIndex } from "./turns";
import type { Piece } from "./pieces";

describe("buildTurnOrder", () => {
  it("A팀원1 -> B팀원1 -> A팀원2 -> B팀원2 순서로 교차한다", () => {
    const order = buildTurnOrder(["a1", "a2"], ["b1", "b2"]);
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("팀당 1명씩(1v1)이면 [A0, B0] 순서다", () => {
    const order = buildTurnOrder(["a1"], ["b1"]);
    expect(order).toEqual(["a1", "b1"]);
  });
});

describe("nextTurnIndex", () => {
  const order = ["a1", "b1", "a2", "b2"];

  it("다음 사람으로 넘어간다", () => {
    expect(nextTurnIndex(0, order)).toBe(1);
  });

  it("순환 순서 끝에서는 처음으로 돌아온다", () => {
    expect(nextTurnIndex(3, order)).toBe(0);
  });
});

describe("checkWinner", () => {
  function finishedPiece(id: string, ownerId: string, teamId = "A"): Piece {
    return { id, ownerId, teamId, character: "교주", position: { kind: "finished" }, previousPosition: { kind: "start" } };
  }
  function unfinishedPiece(id: string, ownerId: string, teamId = "A"): Piece {
    return { id, ownerId, teamId, character: "교주", position: { kind: "outer", index: 3 }, previousPosition: { kind: "start" } };
  }

  it("자기 말 2개가 모두 완주하면 승리", () => {
    const pieces = [finishedPiece("p1", "alice"), finishedPiece("p2", "alice")];
    expect(checkWinner(pieces, "alice")).toBe(true);
  });

  it("말 1개만 완주하면 아직 승리 아님", () => {
    const pieces = [finishedPiece("p1", "alice"), unfinishedPiece("p2", "alice")];
    expect(checkWinner(pieces, "alice")).toBe(false);
  });

  it("다른 사람 말이 완주해도 이 owner의 승리로 치지 않는다", () => {
    const pieces = [finishedPiece("p1", "bob"), finishedPiece("p2", "bob")];
    expect(checkWinner(pieces, "alice")).toBe(false);
  });

  it("1v1처럼 말 4개를 조종하는 경우, 4개 중 하나라도 안 끝나면 아직 승리 아님", () => {
    const pieces = [
      finishedPiece("p1", "alice"),
      finishedPiece("p2", "alice"),
      finishedPiece("p3", "alice"),
      unfinishedPiece("p4", "alice"),
    ];
    expect(checkWinner(pieces, "alice")).toBe(false);
  });

  it("말 4개가 전부 완주하면 승리한다", () => {
    const pieces = [
      finishedPiece("p1", "alice"),
      finishedPiece("p2", "alice"),
      finishedPiece("p3", "alice"),
      finishedPiece("p4", "alice"),
    ];
    expect(checkWinner(pieces, "alice")).toBe(true);
  });
});
