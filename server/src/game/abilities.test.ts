import { describe, expect, it } from "vitest";
import { applyGyojuBonus, hasEffectiveCapture, resolveCaptureResponses, type CaptureRecord, type Rng } from "./abilities";
import type { Piece } from "./pieces";
import type { Position } from "./position";

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
  it("이동한 말도 업힌 말도 교주가 아니면 아무 일도 없다", () => {
    const pieces = [piece("p1", "alice", "A", "성직", 8), piece("p2", "alice", "A", "의사", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
    expect(result.capturedPieceIds).toEqual([]);
    expect(result.fired).toBe(false);
  });

  it("이동한 말은 교주가 아니어도 업힌 말이 교주면 발동한다(2026-08-24 조건 확장)", () => {
    const pieces = [piece("p1", "alice", "A", "성직", 8), piece("p2", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    const p2 = result.pieces.find((p) => p.id === "p2")!;
    expect(result.fired).toBe(true);
    expect(result.triggeredBy).toBe("p2"); // 업혀서 따라온 교주 쪽이 발동 주체
    expect(p1.position).toEqual({ kind: "outer", index: 9 }); // 그룹 전원 전진
    expect(p2.position).toEqual({ kind: "outer", index: 9 });
  });

  it("가만히 있던 교주 위로 다른 말이 이동해와 업힌 경우엔 발동하지 않는다(2026-08-30)", () => {
    // p2(교주)는 이번 이동으로 전혀 움직이지 않았다 — landedGroupIds엔 있지만
    // movedWithMoverIds엔 없다(제자리에 서 있다가 막 업힘). 교주 본인이 이동 주체가 아니므로
    // 발동 후보가 아니다.
    const pieces = [piece("p1", "alice", "A", "성직", 8), piece("p2", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], [], ALWAYS_SUCCEED);
    expect(result.fired).toBe(false);
    expect(result.pieces).toEqual(pieces);
  });

  it("업힌 말이 없으면(piggybackedIds 빈 배열) 발동하지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", [], [], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
  });

  it("80% 확률 실패 시 보너스 전진이 일어나지 않는다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_FAIL);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 });
  });

  it("확률 성공 시 업힌 말 전원이 1칸 추가 전진한다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    const p2 = result.pieces.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 });
    expect(p2.position).toEqual({ kind: "outer", index: 9 });
    expect(result.triggeredBy).toBe("p1"); // 이동한 말 자신이 교주
  });

  it("이동한 말이 shortcutCross 위치(5번 지름길 교차 구간)에 있어도 보너스가 발동한다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "shortcutIn", junction: 5, step: 2 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutCross", step: 1 },
        previousPosition: { kind: "start" },
      },
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.fired).toBe(true);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "shortcutCross", step: 2 }); // 1칸 추가 전진
  });

  it("업힌 그룹에 교주가 여럿이면 그중 하나를 triggeredBy로 보고한다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8),
      piece("p2", "alice", "A", "교주", 8), // 1v1 중복 캐릭터 상황 가정
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.fired).toBe(true);
    expect(["p1", "p2"]).toContain(result.triggeredBy);
  });

  it("보너스 전진 칸에 상대 말이 있으면 잡아서 capturedPieceIds에 담는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8),
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy1", "bob", "B", "의사", 9),
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
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
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 8 }); // 저지되어 전진 없음
  });

  it("교주가 지름길 중간칸(shortcutOut)에서 업은 채로 있어도 보너스 전진이 발동할 수 있다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    pieces[0].position = { kind: "shortcutOut", step: 2 };
    pieces[1].position = { kind: "shortcutOut", step: 2 };
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    const p2 = result.pieces.find((p) => p.id === "p2")!;
    // shortcutOut 2단계에서 1칸 더 가면(3+2+1=6) 도착점(외곽 20번)에 멈춰 선다 — 도착점 도착만으로는
    // 아직 완주가 아니다(2026-08-28 변경).
    expect(p1.position).toEqual({ kind: "outer", index: 20 });
    expect(p2.position).toEqual({ kind: "outer", index: 20 });
  });

  it("상대 마담이 다른 줄이면 저지되지 않는다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8), // 변 B
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 12), // 변 C, 다른 줄
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    const p1 = result.pieces.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 9 }); // 정상 발동
  });

  it("이동한 말(교주)이 이미 완주(finished)했다면 보너스 없이 그대로 반환한다 — moveForward 예외 방지", () => {
    const pieces = [
      { ...piece("p1", "alice", "A", "교주", 8), position: { kind: "finished" as const } },
      piece("p2", "alice", "A", "성직", 8),
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.pieces).toEqual(pieces);
    expect(result.capturedPieceIds).toEqual([]);
  });

  it("발동에 성공하면 fired가 true다(UI 알림용)", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.fired).toBe(true);
    expect(result.blockedBy).toBeNull();
  });

  it("80% 확률에 실패하면 fired가 false다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8), piece("p2", "alice", "A", "성직", 8)];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_FAIL);
    expect(result.fired).toBe(false);
  });

  it("자격 자체가 안 되면(업힌 말 없음) fired가 false다", () => {
    const pieces = [piece("p1", "alice", "A", "교주", 8)];
    const result = applyGyojuBonus(pieces, "p1", [], [], ALWAYS_SUCCEED);
    expect(result.fired).toBe(false);
    expect(result.blockedBy).toBeNull();
  });

  it("마담에게 저지되면 fired는 false, blockedBy에 그 마담의 id가 담긴다", () => {
    const pieces = [
      piece("p1", "alice", "A", "교주", 8),
      piece("p2", "alice", "A", "성직", 8),
      piece("enemy-madam", "bob", "B", "마담", 7),
    ];
    const result = applyGyojuBonus(pieces, "p1", ["p2"], ["p2"], ALWAYS_SUCCEED);
    expect(result.fired).toBe(false);
    expect(result.blockedBy).toBe("enemy-madam");
  });
});

describe("resolveCaptureResponses", () => {
  function capture(
    pieceId: string,
    teamId: string,
    index: number,
    originalPreviousPosition: Position = { kind: "start" },
  ): CaptureRecord {
    return { pieceId, teamId, originalPosition: { kind: "outer", index }, originalPreviousPosition };
  }

  it("잡힌 팀에 조건을 만족하는 의사가 있고 확률이 성공하면 원위치로 복원한다", () => {
    const pieces = [
      piece("victim", "bob", "B", "성직", 0), // 이미 start로 이동된 상태를 가정(0 index는 편의상 표시용, 실제로는 start)
      piece("uisa", "bob", "B", "의사", 7), // victim의 원래 칸(8)과 같은 줄(B)
    ];
    pieces[0].position = { kind: "start" }; // applyMove가 이미 잡아 옮겨놓은 상태
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
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
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
  });

  it("의사/성직 둘 다 없거나 실패하면 잡힌 상태(start) 그대로 유지된다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("uisa", "bob", "B", "의사", 7)];
    pieces[0].position = { kind: "start" };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_FAIL);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" });
  });

  it("잡힌 말 자신이 의사/성직이면 그 능력은 자기 자신에 대해 발동하지 않는다", () => {
    const pieces = [piece("uisa", "bob", "B", "의사", 0)];
    pieces[0].position = { kind: "start" };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("uisa", "B", 8)], ALWAYS_SUCCEED);
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
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 }); // 의사는 제외, 성직이 성공
  });

  it("성직은 '같은 줄' 제한이 없다 — 팀 어디에 있어도 발동 후보다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0), piece("seongjik", "bob", "B", "성직", 15)];
    pieces[0].position = { kind: "start" };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
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
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
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
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], rng);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
  });

  it("의사가 복원할 때 previousPosition도 잡히기 직전 값으로 되돌아간다(빽도 판정 정확성)", () => {
    const pieces = [piece("victim", "bob", "B", "성직", 0), piece("uisa", "bob", "B", "의사", 7)];
    pieces[0].position = { kind: "start" };
    const priorPrevious: Position = { kind: "outer", index: 6 };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8, priorPrevious)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 8 });
    expect(victim.previousPosition).toEqual(priorPrevious); // originalPreviousPosition으로 복원
  });

  it("성직이 순간이동시킬 때 previousPosition도 도착지(성직 위치)와 같아진다(직후 빽도는 제자리)", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 12), // 다른 줄(C) — 의사는 제외되고 성직으로 넘어간다
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "outer", index: 15 });
    expect(victim.previousPosition).toEqual({ kind: "outer", index: 15 }); // 도착지와 동일 — 빽도는 no-op
  });

  it("성직이 지름길 중간칸(shortcutIn)에 있어도 잡힌 아군을 구조할 수 있다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 8), piece("seongjik", "bob", "B", "성직", 15)];
    pieces[0].position = { kind: "start" };
    pieces[1].position = { kind: "shortcutIn", junction: 15, step: 1 };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "shortcutIn", junction: 15, step: 1 }); // 성직 위치로 순간이동
  });

  it("의사가 지름길 칸(shortcutIn)에 있으면 '같은 줄'이 성립하지 않아 잡힌 아군을 구조할 수 없다(의도된 동작 — center도 이미 마찬가지)", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 8), piece("uisa", "bob", "B", "의사", 7)];
    pieces[0].position = { kind: "start" };
    pieces[1].position = { kind: "shortcutIn", junction: 5, step: 1 };
    const { pieces: result } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    const victim = result.find((p) => p.id === "victim")!;
    expect(victim.position).toEqual({ kind: "start" });
  });
});

describe("resolveCaptureResponses의 effects (UI 알림용 발동 내역)", () => {
  function capture(pieceId: string, teamId: string, index: number): CaptureRecord {
    return { pieceId, teamId, originalPosition: { kind: "outer", index }, originalPreviousPosition: { kind: "start" } };
  }

  it("의사가 성공하면 그 캡처의 effect에 negated:true가 담긴다", () => {
    const pieces = [
      piece("victim", "bob", "B", "성직", 0),
      piece("uisa", "bob", "B", "의사", 7),
    ];
    pieces[0].position = { kind: "start" };
    const { effects } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    expect(effects).toEqual([{ pieceId: "victim", negated: true, redirectedTo: null, blockedBy: null }]);
  });

  it("성직이 성공하면 그 캡처의 effect에 redirectedTo로 성직 pieceId가 담긴다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 12), // 다른 줄 — 의사 제외
      piece("seongjik", "bob", "B", "성직", 15),
    ];
    pieces[0].position = { kind: "start" };
    const { effects } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    expect(effects).toEqual([{ pieceId: "victim", negated: false, redirectedTo: "seongjik", blockedBy: null }]);
  });

  it("마담이 저지하면 blockedBy에 그 마담의 pieceId가 담긴다", () => {
    const pieces = [
      piece("victim", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
      piece("enemy-madam", "alice", "A", "마담", 9),
    ];
    pieces[0].position = { kind: "start" };
    const { effects } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    expect(effects).toEqual([{ pieceId: "victim", negated: false, redirectedTo: null, blockedBy: "enemy-madam" }]);
  });

  it("아무도 반응하지 않으면(후보 없음) effect 전부 null/false다", () => {
    const pieces = [piece("victim", "bob", "B", "마담", 0)];
    pieces[0].position = { kind: "start" };
    const { effects } = resolveCaptureResponses(pieces, [capture("victim", "B", 8)], ALWAYS_SUCCEED);
    expect(effects).toEqual([{ pieceId: "victim", negated: false, redirectedTo: null, blockedBy: null }]);
  });

  it("캡처가 여러 건이면 effects도 같은 순서로 여러 건 담긴다", () => {
    const pieces = [
      piece("victim1", "bob", "B", "마담", 0),
      piece("victim2", "bob", "B", "마담", 0),
      piece("uisa", "bob", "B", "의사", 7),
    ];
    pieces[0].position = { kind: "start" };
    pieces[1].position = { kind: "start" };
    const { effects } = resolveCaptureResponses(
      pieces,
      [capture("victim1", "B", 8), capture("victim2", "B", 8)],
      ALWAYS_SUCCEED,
    );
    expect(effects).toHaveLength(2);
    expect(effects[0].pieceId).toBe("victim1");
    expect(effects[1].pieceId).toBe("victim2");
  });
});

describe("hasEffectiveCapture", () => {
  function record(pieceId: string): CaptureRecord {
    return { pieceId, teamId: "B", originalPosition: { kind: "outer", index: 8 }, originalPreviousPosition: { kind: "start" } };
  }

  it("무효화되지 않은 캡처가 하나라도 있으면 true", () => {
    expect(hasEffectiveCapture([record("victim")], [])).toBe(true);
  });

  it("모든 캡처가 무효화됐으면 false", () => {
    expect(hasEffectiveCapture([record("victim")], ["victim"])).toBe(false);
  });

  it("여러 캡처 중 일부만 무효화됐으면 true(하나라도 살아남으면 인정)", () => {
    expect(hasEffectiveCapture([record("a"), record("b")], ["a"])).toBe(true);
  });

  it("캡처 자체가 없으면 false", () => {
    expect(hasEffectiveCapture([], [])).toBe(false);
  });
});
