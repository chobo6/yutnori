import { describe, expect, it } from "vitest";
import { applyMove, type Piece } from "./pieces";

// alice/amy는 A팀, bob은 B팀. teamId를 명시하지 않으면 소유자 이름으로 팀을 추론한다.
const TEAM_OF: Record<string, string> = { alice: "A", amy: "A", bob: "B", ben: "B" };

function piece(id: string, ownerId: string, index: number, teamId = TEAM_OF[ownerId] ?? "A", character = "교주"): Piece {
  return {
    id,
    ownerId,
    teamId,
    character,
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

  it("이동 후 previousPosition은 '이동 시작 전' 칸이 아니라 '착지 1칸 전' 칸으로 갱신된다(빽도는 항상 -1칸이어야 하므로, 2026-08-28)", () => {
    // 3에서 2칸(개) 이동해 5에 착지 — previousPosition은 이동을 시작한 3이 아니라 착지 1칸
    // 전인 4여야 한다. 3으로 두면 나중에 빽도를 맞았을 때 2칸(개와 같은 칸수)을 되돌아가버려서
    // REQUIREMENTS.md §7의 "빽도 -1칸"을 어기게 된다 — 실제로 신고된 버그.
    const pieces = [piece("p1", "alice", 3)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false);
    expect(result[0].previousPosition).toEqual({ kind: "outer", index: 4 });
  });

  it("대기 상태에서 '도'(1칸)로 막 나온 말의 previousPosition은 대기 상태가 아니라 도착점(외곽 20번)이다(2026-08-30 버그 수정)", () => {
    // 보드는 시작점과 도착점이 물리적으로 같은 모서리를 도는 순환 트랙이다(position.ts의
    // LAST_OUTER_INDEX 주석 참고) — "도" 한 칸 전은 대기 상태(아직 판에 놓이지 않음)가
    // 아니라 그 도착점 칸이어야, 나중에 빽도를 맞았을 때 도착점에 있던 다른 말과 정상적으로
    // 잡기/업기 상호작용을 할 수 있다. 예전엔 이 경우 previousPosition을 그대로 start로 둬서,
    // 도착점에 있던 상대 말과 아무 상호작용도 없이 그냥 대기 상태로 사라져버리는 버그가 있었다.
    const pieces: Piece[] = [
      { id: "p1", ownerId: "alice", teamId: "A", character: "교주", position: { kind: "start" }, previousPosition: { kind: "start" } },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false);
    const p1 = result.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 1 });
    expect(p1.previousPosition).toEqual({ kind: "outer", index: 20 });
  });

  it("'도' 자리에서 빽도를 맞으면 대기 상태가 아니라 도착점(외곽 20번)으로 돌아가고, 거기 있던 상대 말을 정상적으로 잡는다(2026-08-30 버그 수정)", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "outer", index: 1 },
        previousPosition: { kind: "outer", index: 20 }, // 위 테스트에서 확인한 정상 값
      },
      piece("enemy1", "bob", 20),
    ];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", -1, false);
    const p1 = result.find((p) => p.id === "p1")!;
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 20 });
    expect(enemy.position).toEqual({ kind: "start" }); // 잡힘
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });

  it("2칸 이동 후 빽도를 맞으면 그 이동 전체(2칸)가 아니라 정확히 1칸만 되돌아간다(2026-08-28 버그 수정)", () => {
    const afterAdvance = applyMove([piece("p1", "alice", 3)], "p1", 2, false).pieces; // 3 -> 5
    expect(afterAdvance[0].position).toEqual({ kind: "outer", index: 5 });

    const afterBackDo = applyMove(afterAdvance, "p1", -1, false).pieces;
    expect(afterBackDo[0].position).toEqual({ kind: "outer", index: 4 }); // 5에서 정확히 1칸 뒤
  });

  it("steps가 -1(빽도)이면 직전 위치로 되돌린다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "outer", index: 7 },
        previousPosition: { kind: "outer", index: 4 },
      },
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

  it("함께 이동한 말도 previousPosition이 착지 1칸 전 위치로 갱신된다", () => {
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { pieces: result } = applyMove(pieces, "p1", 2, false); // 5 -> 7
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p2.previousPosition).toEqual({ kind: "outer", index: 6 });
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

  it("도착 칸에 상대 팀 말이 있으면 시작점으로 돌려보내고 capturedPieceIds에 담는다", () => {
    const pieces = [piece("p1", "alice", 3), piece("enemy1", "bob", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });

  it("도착 칸에 같은 팀 동료(주인은 다름)의 말이 있어도 잡히지 않는다", () => {
    // alice와 amy는 둘 다 A팀 — 아군 오사(friendly fire)가 발생하면 안 된다.
    const pieces = [piece("p1", "alice", 3), piece("mate1", "amy", 5)];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const mate = result.find((p) => p.id === "mate1")!;
    expect(mate.position).toEqual({ kind: "outer", index: 5 }); // 제자리
    expect(capturedPieceIds).toEqual([]);
  });

  it("같은 팀 동료(주인은 다름)의 말도 업기 대상이라 함께 이동한다(2026-09-02 변경 — 이전엔 자신의 말끼리만 업혔다)", () => {
    // 업기는 이제 "같은 팀 말끼리" 성립한다 (REQUIREMENTS.md §6).
    const pieces = [piece("p1", "alice", 5), piece("mate1", "amy", 5)];
    const { pieces: result, piggybackedIds } = applyMove(pieces, "p1", 2, false); // p1: 5->7
    const p1 = result.find((p) => p.id === "p1")!;
    const mate = result.find((p) => p.id === "mate1")!;
    expect(p1.position).toEqual({ kind: "outer", index: 7 });
    expect(mate.position).toEqual({ kind: "outer", index: 7 }); // 팀 동료도 같이 이동
    expect(piggybackedIds).toEqual(["mate1"]);
  });

  it("도착 칸에 아군(내 말·동료 말)과 상대 팀 말이 섞여 있으면 상대 팀 말만 잡힌다", () => {
    const pieces = [
      piece("p1", "alice", 3),
      piece("p2", "alice", 5),
      piece("mate1", "amy", 5),
      piece("enemy1", "bob", 5),
    ];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 2, false);
    const p2 = result.find((p) => p.id === "p2")!;
    const mate = result.find((p) => p.id === "mate1")!;
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(p2.position).toEqual({ kind: "outer", index: 5 }); // 제자리(업힘)
    expect(mate.position).toEqual({ kind: "outer", index: 5 }); // 제자리, 잡히지 않음
    expect(enemy.position).toEqual({ kind: "start" }); // 잡힘
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });

  it("같은 주인의 두 말이 모두 start에 있을 때, 하나를 출발시키면 다른 하나는 start에 남아 있다", () => {
    // p1과 p2 모두 {kind:"start"}에서 시작
    const pieces: Piece[] = [
      { id: "p1", ownerId: "alice", teamId: "A", character: "교주", position: { kind: "start" }, previousPosition: { kind: "start" } },
      { id: "p2", ownerId: "alice", teamId: "A", character: "성직", position: { kind: "start" }, previousPosition: { kind: "start" } },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false); // p1을 start에서 출발시킴
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "outer", index: 1 }); // p1이 이동
    expect(p2.position).toEqual({ kind: "start" }); // p2는 start에 그대로
  });

  it("업힌 말이 있으면 piggybackedIds에 그 말들의 id가 담긴다", () => {
    const pieces = [piece("p1", "alice", 5), piece("p2", "alice", 5)];
    const { piggybackedIds } = applyMove(pieces, "p1", 2, false);
    expect(piggybackedIds).toEqual(["p2"]);
  });

  it("업힌 말이 없으면 piggybackedIds는 빈 배열이다", () => {
    const pieces = [piece("p1", "alice", 3)];
    const { piggybackedIds } = applyMove(pieces, "p1", 2, false);
    expect(piggybackedIds).toEqual([]);
  });

  it("지름길 중간칸(shortcutIn)에서도 같은 모서리+같은 단계면 업기가 성립한다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false);
    const p1 = result.find((p) => p.id === "p1")!;
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p1.position).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    expect(p2.position).toEqual({ kind: "shortcutIn", junction: 5, step: 2 }); // 같이 이동
  });

  it("같은 단계라도 지름길 진입 모서리가 다르면 다른 칸으로 취급해 업기가 안 된다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
      {
        id: "p2",
        ownerId: "alice",
        teamId: "A",
        character: "성직",
        position: { kind: "shortcutIn", junction: 10, step: 1 },
        previousPosition: { kind: "outer", index: 10 },
      },
    ];
    const { pieces: result } = applyMove(pieces, "p1", 1, false);
    const p2 = result.find((p) => p.id === "p2")!;
    expect(p2.position).toEqual({ kind: "shortcutIn", junction: 10, step: 1 }); // 그대로, 업기 안 됨
  });

  it("지름길 중간칸에서 상대 팀 말을 잡을 수 있다", () => {
    const pieces: Piece[] = [
      {
        id: "p1",
        ownerId: "alice",
        teamId: "A",
        character: "교주",
        position: { kind: "outer", index: 5 },
        previousPosition: { kind: "start" },
      },
      {
        id: "enemy1",
        ownerId: "bob",
        teamId: "B",
        character: "마담",
        position: { kind: "shortcutIn", junction: 5, step: 1 },
        previousPosition: { kind: "outer", index: 5 },
      },
    ];
    const { pieces: result, capturedPieceIds } = applyMove(pieces, "p1", 1, true);
    const enemy = result.find((p) => p.id === "enemy1")!;
    expect(enemy.position).toEqual({ kind: "start" });
    expect(capturedPieceIds).toEqual(["enemy1"]);
  });
});

describe("samePosition — cross 트랙(shortcutCross)", () => {
  it("같은 step의 shortcutCross는 같은 칸으로 취급되어 업힌다", () => {
    // applyMove는 "이동 전(previousPosition이 아니라 현재 position) 위치 기준"으로 업기를
    // 판정한다(CLAUDE.md) — p1과 p2를 둘 다 shortcutCross(step:1)에 세워두고 p2를 1칸
    // 이동시키면, p2의 이동 전 위치(shortcutCross step:1)에 같은 주인의 p1이 있었으므로
    // p1도 함께 업혀서 이동해야 한다.
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
        previousPosition: { kind: "shortcutIn", junction: 5, step: 2 },
      },
    ];
    const { pieces: result, piggybackedIds } = applyMove(pieces, "p2", 1, false);
    expect(piggybackedIds).toEqual(["p1"]);
    const p1 = result.find((p) => p.id === "p1")!;
    expect(p1.position).toEqual({ kind: "shortcutCross", step: 2 });
  });
});
