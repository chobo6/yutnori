import { describe, expect, it } from "vitest";
import { applyGyojuBonus, resolveCaptureResponses, type CaptureRecord, type Rng } from "./abilities";
import type { Piece } from "./pieces";

const ALWAYS_SUCCEED: Rng = () => 0;
const ALWAYS_FAIL: Rng = () => 0.99;

function piece(id: string, ownerId: string, teamId: string, character: string, index: number): Piece {
  return {
    id,
    ownerId,
    teamId,
    character,
    position: { kind: "outer", index },
    previousPosition: { kind: "start" },
  };
}

describe("applyGyojuBonus", () => {
  it("이동한 말이 교주가 아니면 아무 일도 없다", () => {
    const pieces = [piece("p1", "alice", "A", "성직", 8), piece("p2", "alice", "A", "의사", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
    expect(result.capturedPieceIds).toEqual([]);
  });

  it("업힌 말이 없으면(piggybackedIds 빈 배열) 발동하지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", [], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
  });

  it("80% 확률 실패 시 보너스 전진이 일어나지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_FAIL);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 });
  });

  it("확률 성공 시 업힌 말 전원이 1칸 추가 전진한다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    const p2 = result.pieces.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 });
    expect(p2.position).toEqual({ kind: "outer", index: 9 });
  });

  it("보너스 전진 칸에 상대 말이 있으면 잡아서 capturedPieceIds에 담는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8),
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy1", "bob", "B", "의사", 9),
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const enemy = result.pieces.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(result.capturedPieceIds).toEqual(["enemy1"]);
  });

  it("같은 줄에 상대 마담이 있으면 저지되어(확률 성공값이어도) 발동하지 않는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8), // 변 B(6~10)
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 7), // 변 B, 상대팀
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 }); // 저지되어 전진 없음
  });

  it("상대 마담이 다른 줄이면 저지되지 않는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8), // 변 B
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 12), // 변 C, 다른 줄
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 }); // 정상 발동
  });
});

describe("resolveCaptureResponses", () => {
  function capture(pieceId: string, teamId: string, index: number): CaptureRecord {
    return { pieceId, teamId, originalPosition: { kind: "outer", index } };
  }

  it("잡힌 팀에 조건을 만족하는 의사가 있고 확률이 성공하면 원위치로 복원한다", () => {
    const pieces = [
      piece("victim", "bob", "B", "성직", 0), // 이미 start로 이동된 상태를 가정(0 index는 편의상 표시용, 실제로는 start)
      piece("uisa", "bob", "B", "의사", 7), // victim의 원래 칸(8)과 같은 줄(B)
    ];
    pieces[0].position = { kind: "start" }; // applyMove가 이미 잡아 옮겨놓은 상태
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
  });

  it("의사가 실패하면 이어서 성직이 판정해 성공 시 성직 위치로 순간이동시킨다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    // UISA_CHANCE(0.35) 미만이면 성공 - 0.37은 실패, SEONGJIK_CHANCE(0.4) 미만이면 성공 - 0.37은 성공
    const rng: Rng = () => 0.37;
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
  });

  it("의사/성직 둘 다 없거나 실패하면 잡힌 상태(start) 그대로 유지된다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("uisa", "bob", "B", "의사", 7)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_FAIL);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" });
  });

  it("잡힌 말 자신이 의사/성직이면 그 능력은 자기 자신에 대해 발동하지 않는다", () => {
    const pieces = [piece("uisa", "bob", "B", "의사", 0)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("uisa", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "uisa")!;
    expect(victim.position).toEqual({ kind: "start" }); // 무효화되지 않음
  });

  it("의사는 '같은 줄'이 아니면 발동 후보에서 제외된다(성직으로 넘어간다)", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 12), // 변 C — victim의 원래 칸(8, 변 B)과 다른 줄
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 }); // 의사는 제외, 성직이 성공
  });

  it("성직은 '같은 줄' 제한이 없다 — 팀 어디에 있어도 발동 후보다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("seongjik", "bob", "B", "성직", 15)];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
  });

  it("같은 줄에 상대 마담이 있으면 의사/성직 모두 저지되어 정상 잡힘으로 확정된다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
      piece("seongjik", "bob", "B", "성직", 15),
      piece("enemy-madam", "alice", "A", "마담", 9), // victim 원래 칸(8)과 같은 줄(B), 상대팀(A)
    ];
    pieces[0].position = { kind: "start" };
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" }); // 저지되어 그대로 잡힘
  });

  it("같은 팀에 의사가 2개 있으면 하나라도 성공할 때까지 순회한다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa1", "bob", "B", "의사", 6), // 첫 번째 후보
      piece("uisa2", "bob", "B", "의사", 9), // 두 번째 후보
    ];
    pieces[0].position = { kind: "start" };
    let call = 0;
    // 첫 번째 의사(uisa1) 시도만 실패(0.5 >= 0.35), 두 번째(uisa2)는 성공(0.1 < 0.35)
    const rng: Rng = () => (call++ === 0 ? 0.5 : 0.1);
    const result = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
  });
});
