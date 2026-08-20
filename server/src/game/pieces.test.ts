import { describe, expect, it } from "vitest";
import { applyMove, type Piece } from "./pieces";

function piece(id: string, ownerId: string, index: number): Piece {
  return {
    id,
    ownerId,
    position: { kind: "outer", index },
    previousPosition: { kind: "start" },
  };
}

describe("applyMove", () => {
  it("지정한 말을 steps만큼 전진시킨다", () => {
    const pieces = [piece("p1", "alice", 3)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    expect(result[0].position).toEqual({ kind: "outer", index: 5 });
  });

  it("이동 후 previousPosition을 이동 전 위치로 갱신한다", () => {
    const pieces = [piece("p1", "alice", 3)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    expect(result[0].previousPosition).toEqual({ kind: "outer", index: 3 });
  });

  it("steps가 -1(빽도)이면 직전 위치로 되돌린다", () => {
    const pieces: Piece[] = [
      { id: "p1", ownerId: "alice", position: { kind: "outer", index: 7 }, previousPosition: { kind: "outer", index: 4 } },
    ];
    const { pieces: result } = applyMove(pieces, "p1", -1, false);
    expect(result[0].position).toEqual({ kind: "outer", index: 4 });
  });

  it("이미 업혀 있던(같은 칸에 있던) 같은 주인의 말은 함께 이동한다", () => {
    // p1, p2가 이전 턴에 이미 같은 칸(5번)에서 업힌 상태로 시작
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false); // p1: 5->7
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 7 });
    expect(p2.position).toEqual({ kind: "outer", index: 7 }); // 같이 이동
  });

  it("함께 이동한 말도 previousPosition이 이동 전 위치로 갱신된다", () => {
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p2.previousPosition).toEqual({ kind: "outer", index: 5 });
  });

  it("도착 칸에 이미 있던 같은 주인의 말은 업히기만 하고(제자리), 잡히지 않는다", () => {
    // p2는 도착 칸(5번)에 미리 있었을 뿐 p1과 함께 출발한 게 아니므로 이동하지 않는다 —
    // 이 시점부터 둘은 같은 칸에 있게 되어 "업힌" 상태가 되고, 다음 이동부터 함께 움직인다.
    const pieces = [piece("p1", "alice", 3), piece("p2", "alice", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false); // p1: 3->5
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 5 });
    expect(p2.position).toEqual({ kind: "outer", index: 5 }); // 원래 있던 자리 그대로
    expect(capturedPieceIds).toEqual([]); // 자기 말은 잡히지 않음
  });

  it("도착 칸에 상대 말이 있으면 시작점으로 돌려보내고 capturedPieceIds에 담는다", () => {
    const pieces = [piece("p1", "alice", 3), piece("enemy1", "bob", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });

  it("도착 칸에 내 말과 상대 말이 섞여 있으면 내 말은 그대로, 상대 말만 잡힌다", () => {
    const pieces = [piece("p1", "alice", 3), piece("p2", "alice", 5), piece("enemy1", "bob", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const p2 = result.find((p) => p.id === "p2")!;
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(p2.position).toEqual({ kind: "outer", index: 5 }); // 제자리(업힘)
    expect(enemy.position).toEqual({ kind: "start" }); // 잡힘
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });
});
