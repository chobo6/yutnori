import { describe, expect, it } from "vitest";
import { moveBackward, moveForward, sameSide, sidesOf, type Position } from "./position";

describe("moveForward", () => {
  it("출발 전 말이 도(1)를 던지면 외곽 1번 칸으로 이동한다", () => {
    const result = moveForward({ kind: "start" }, 1, false);
    expect(result).toEqual({ kind: "outer", index: 1 });
  });

  it("출발 전 말이 모(5)를 던지면 외곽 5번 칸(첫 지름길 모서리)에 도착한다", () => {
    const result = moveForward({ kind: "start" }, 5, false);
    expect(result).toEqual({ kind: "outer", index: 5 });
  });

  it("외곽 15번 칸에서 3칸 이동하면 외곽 18번 칸이다", () => {
    const result = moveForward({ kind: "outer", index: 15 }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 18 });
  });

  it("외곽 17번 칸에서 5칸 이동하면(17+5=22, 도착점을 넘김) 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 17 }, 5, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("정확히 도착점(외곽 20번, 19+도 1칸)에 도착하면 완주가 아니라 그 칸에 멈춰 선다(2026-08-28 변경)", () => {
    // 도착점에 도착만 해서는 완주하지 않는다 — 사용자 명시 요청. 거기서 한 칸이라도 더
    // 나가야(21 이상) 비로소 완주한다(아래 별도 테스트).
    const result = moveForward({ kind: "outer", index: 19 }, 1, false);
    expect(result).toEqual({ kind: "outer", index: 20 });
  });

  it("도착점(외곽 20번)에서 한 칸이라도 더 가면 그제서야 완주한다(2026-08-28 변경)", () => {
    const result = moveForward({ kind: "outer", index: 20 }, 1, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("지름길 모서리(10번)에서 지름길을 안 쓰면 그냥 외곽으로 계속 간다", () => {
    const result = moveForward({ kind: "outer", index: 10 }, 2, false);
    expect(result).toEqual({ kind: "outer", index: 12 });
  });

  it("완주한 말을 다시 이동시키려 하면 에러", () => {
    expect(() => moveForward({ kind: "finished" }, 1, false)).toThrow();
  });

  describe("지름길 진입 (모서리에서 useShortcut=true)", () => {
    it("1칸(도)이면 shortcutIn 1단계", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 1, true);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 1 });
    });

    it("2칸(개)이면 shortcutIn 2단계", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 2, true);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    });

    it("3칸(걸)이면 중앙에 도착한다", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 3, true);
      expect(result).toEqual({ kind: "center", exitVia: "finish" });
    });

    it("5번에서 3칸(걸)이면 중앙에 도착하고 cross 트랙으로 기록된다", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 3, true);
      expect(result).toEqual({ kind: "center", exitVia: "cross" });
    });

    it("10번에서 3칸(걸)이면 중앙에 도착하고 finish 트랙으로 기록된다(기존 동작 유지)", () => {
      expect(moveForward({ kind: "outer", index: 10 }, 3, true)).toEqual({ kind: "center", exitVia: "finish" });
    });

    it("15번은 useShortcut=true를 줘도 지름길이 없다 — 그냥 바깥길로 3칸(걸)(2026-08-27 변경)", () => {
      // 진짜 교차 모델대로면 5번으로 떨어지고, 기존 예외(finish 방향 유지)대로면 6칸 걸려
      // 바깥길 그대로(5칸)보다 오히려 손해라 아예 선택지를 없앴다 — 위 SHORTCUT_JUNCTIONS 참고.
      const result = moveForward({ kind: "outer", index: 15 }, 3, true);
      expect(result).toEqual({ kind: "outer", index: 18 });
    });

    it("5번에서 4칸(윷)이면 shortcutCross 1단계다(shortcutOut이 아님)", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 4, true);
      expect(result).toEqual({ kind: "shortcutCross", step: 1 });
    });

    it("5번에서 5칸(모)이면 shortcutCross 2단계다", () => {
      const result = moveForward({ kind: "outer", index: 5 }, 5, true);
      expect(result).toEqual({ kind: "shortcutCross", step: 2 });
    });

    it("4칸(윷)이면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 4, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("5칸(모)이면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 5, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("15번에서 5칸(모)은 지름길이 없어 그냥 바깥길로 가서 도착점(20번)에 멈춰 선다(15+5=20, 2026-08-27/28 변경)", () => {
      const result = moveForward({ kind: "outer", index: 15 }, 5, true);
      expect(result).toEqual({ kind: "outer", index: 20 });
    });

    it("15번은 useShortcut을 true/false 어느 쪽으로 줘도 결과가 같다(2026-08-27 변경)", () => {
      const withShortcut = moveForward({ kind: "outer", index: 15 }, 2, true);
      const withoutShortcut = moveForward({ kind: "outer", index: 15 }, 2, false);
      expect(withShortcut).toEqual(withoutShortcut);
      expect(withShortcut).toEqual({ kind: "outer", index: 17 });
    });

    it("서로 다른 모서리에서 탄 shortcutIn은 junction이 다르게 기록된다", () => {
      const from5 = moveForward({ kind: "outer", index: 5 }, 1, true);
      const from10 = moveForward({ kind: "outer", index: 10 }, 1, true);
      expect(from5).toEqual({ kind: "shortcutIn", junction: 5, step: 1 });
      expect(from10).toEqual({ kind: "shortcutIn", junction: 10, step: 1 });
    });
  });

  describe("shortcutIn에서 계속 진행 (선택지 없이 자동)", () => {
    it("1단계에서 1칸 더 가면 같은 모서리의 2단계", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, false);
      expect(result).toEqual({ kind: "shortcutIn", junction: 5, step: 2 });
    });

    it("2단계에서 1칸 더 가면 중앙에 도착한다(5번 진입이므로 cross 트랙)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 2 }, 1, false);
      expect(result).toEqual({ kind: "center", exitVia: "cross" });
    });

    it("10번/15번 shortcutIn 2단계에서 1칸 더 가면 finish 트랙 중앙에 도착한다(기존 동작 유지)", () => {
      expect(moveForward({ kind: "shortcutIn", junction: 10, step: 2 }, 1, false)).toEqual({
        kind: "center",
        exitVia: "finish",
      });
      expect(moveForward({ kind: "shortcutIn", junction: 15, step: 2 }, 1, false)).toEqual({
        kind: "center",
        exitVia: "finish",
      });
    });

    it("1단계에서 모(5칸)를 가면 중앙과 도착 구간을 다 지나 도착점(20번)에 멈춰 선다(1+5=6, 2026-08-28 변경)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 10, step: 1 }, 5, false);
      expect(result).toEqual({ kind: "outer", index: 20 });
    });

    it("1단계에서 6칸을 가면 도착점을 지나 완주한다(1+6=7)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 10, step: 1 }, 6, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("useShortcut 인자는 무시된다 — 이미 지름길에 올라탄 상태라 선택지가 없다", () => {
      const withTrue = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, true);
      const withFalse = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, false);
      expect(withTrue).toEqual(withFalse);
    });
  });

  describe("center(exitVia=finish)에서 계속 진행 (10번/15번 진입 — 항상 도착 방향으로 자동)", () => {
    it("1칸 가면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "center", exitVia: "finish" }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("2칸 가면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "center", exitVia: "finish" }, 2, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("3칸 가면 도착점(20번)에 멈춰 선다(2026-08-28 변경, 절대값 3+3=6)", () => {
      expect(moveForward({ kind: "center", exitVia: "finish" }, 3, false)).toEqual({ kind: "outer", index: 20 });
    });

    it("4칸 이상 가면 도착점을 지나 완주한다", () => {
      expect(moveForward({ kind: "center", exitVia: "finish" }, 4, false)).toEqual({ kind: "finished" });
      expect(moveForward({ kind: "center", exitVia: "finish" }, 5, true)).toEqual({ kind: "finished" });
    });
  });

  describe("shortcutOut에서 계속 진행", () => {
    it("1단계에서 1칸 더 가면 2단계", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("1단계에서 2칸 가면 도착점(20번)에 멈춰 선다(2026-08-28 변경, 절대값 3+1+2=6)", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 2, false);
      expect(result).toEqual({ kind: "outer", index: 20 });
    });

    it("1단계에서 3칸 가면 도착점을 지나 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 3, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("2단계에서 1칸만 더 가면 도착점(20번)에 멈춰 선다(2026-08-28 변경, 절대값 3+2+1=6)", () => {
      const result = moveForward({ kind: "shortcutOut", step: 2 }, 1, false);
      expect(result).toEqual({ kind: "outer", index: 20 });
    });

    it("2단계에서 2칸 가면 도착점을 지나 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 2 }, 2, false);
      expect(result).toEqual({ kind: "finished" });
    });
  });
});

describe("cross 트랙 (5번 지름길 — 15번으로 실제 교차)", () => {
  it("centerCross(중앙, exitVia=cross)에서 useShortcut=false로 1칸 가면 계속 cross 트랙(shortcutCross 1단계)", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 1, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 1 });
  });

  it("centerCross에서 useShortcut=false로 2칸 가면 shortcutCross 2단계", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 2, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 2 });
  });

  it("centerCross에서 useShortcut=false로 3칸 가면 정확히 외곽 15번 칸에 착지한다(완주가 아님)", () => {
    const result = moveForward({ kind: "center", exitVia: "cross" }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  describe("centerCross에서 useShortcut=true — 도착 방향으로 전환(2026-08-25 변경)", () => {
    // 5번에서 지름길을 타고 정확히 중앙에 멈춰 선 말은, 원래 트랙(15번 방향)을 계속 타는 것
    // (useShortcut=false, 위 테스트들)과 완주 방향으로 트랙을 바꾸는 것(useShortcut=true)
    // 둘 다 선택할 수 있다 — 사용자가 명시적으로 요청한 예외. 오직 "정확히 centerCross에
    // 멈춰 서 있는 상태"에서만 이 선택지가 있고, shortcutIn/shortcutCross 같은 중간 칸에서는
    // 여전히 선택지가 없다(이미 지름길에 올라탄 이상 자동 진행, 기존 규칙 그대로).
    it("1칸 가면 shortcutOut 1단계(도착 방향 트랙으로 전환)", () => {
      const result = moveForward({ kind: "center", exitVia: "cross" }, 1, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("2칸 가면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "center", exitVia: "cross" }, 2, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("3칸 가면 도착점(20번)에 멈춰 선다(15번이 아니라, 2026-08-28 변경)", () => {
      expect(moveForward({ kind: "center", exitVia: "cross" }, 3, true)).toEqual({ kind: "outer", index: 20 });
    });

    it("4칸 가면 도착점을 지나 완주한다", () => {
      expect(moveForward({ kind: "center", exitVia: "cross" }, 4, true)).toEqual({ kind: "finished" });
    });
  });

  it("shortcutCross 1단계에서 1칸 더 가면 2단계", () => {
    const result = moveForward({ kind: "shortcutCross", step: 1 }, 1, false);
    expect(result).toEqual({ kind: "shortcutCross", step: 2 });
  });

  it("shortcutCross 1단계에서 2칸 더 가면 외곽 15번 칸(완주 아님)", () => {
    const result = moveForward({ kind: "shortcutCross", step: 1 }, 2, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  it("shortcutCross 2단계에서 1칸 더 가면 외곽 15번 칸", () => {
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 1, false);
    expect(result).toEqual({ kind: "outer", index: 15 });
  });

  it("shortcutCross 2단계에서 여러 칸 가면 15번을 넘어 정상적으로 바깥길을 계속 간다(15+2=17)", () => {
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 3, false);
    expect(result).toEqual({ kind: "outer", index: 17 });
  });

  it("cross 트랙을 타고 바깥길에 합류해 정확히 도착점(20번)에 도착하면 멈춰 선다(2026-08-28 변경)", () => {
    // shortcutCross step2(절대값5) + 6칸 = 절대값11 → outer(15+5)=20 → 도착점, 아직 완주 아님
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 6, false);
    expect(result).toEqual({ kind: "outer", index: 20 });
  });

  it("cross 트랙을 타고 바깥길에 합류한 뒤 도착점을 넘기면 정상적으로 완주한다", () => {
    // 절대값12 → outer(15+6)=21 → 도착점(20) 초과 → finished
    const result = moveForward({ kind: "shortcutCross", step: 2 }, 7, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("useShortcut 인자는 cross 트랙에서도 무시된다", () => {
    const withTrue = moveForward({ kind: "shortcutCross", step: 1 }, 1, true);
    const withFalse = moveForward({ kind: "shortcutCross", step: 1 }, 1, false);
    expect(withTrue).toEqual(withFalse);
  });
});

describe("moveBackward", () => {
  it("빽도는 말을 직전 위치로 되돌린다", () => {
    const previous: Position = { kind: "outer", index: 4 };
    const result = moveBackward({ kind: "outer", index: 7 }, previous);
    expect(result).toEqual(previous);
  });

  it("출발 전 말에게 빽도는 아무 효과가 없다", () => {
    const result = moveBackward({ kind: "start" }, { kind: "start" });
    expect(result).toEqual({ kind: "start" });
  });

  it("완주한 말은 빽도로도 되살아나지 않고 에러를 던진다", () => {
    expect(() => moveBackward({ kind: "finished" }, { kind: "outer", index: 19 })).toThrow();
  });

  it("지름길 중간칸에 있던 말도 직전 위치(모서리)로 되돌아간다", () => {
    const previous: Position = { kind: "outer", index: 10 };
    const result = moveBackward({ kind: "shortcutIn", junction: 10, step: 1 }, previous);
    expect(result).toEqual(previous);
  });
});

describe("sidesOf", () => {
  it("outer 1~4는 A만", () => {
    expect(sidesOf({ kind: "outer", index: 1 })).toEqual(["A"]);
    expect(sidesOf({ kind: "outer", index: 4 })).toEqual(["A"]);
  });

  it("outer 6~9는 B만", () => {
    expect(sidesOf({ kind: "outer", index: 6 })).toEqual(["B"]);
    expect(sidesOf({ kind: "outer", index: 9 })).toEqual(["B"]);
  });

  it("outer 11~14는 C만", () => {
    expect(sidesOf({ kind: "outer", index: 11 })).toEqual(["C"]);
    expect(sidesOf({ kind: "outer", index: 14 })).toEqual(["C"]);
  });

  it("outer 16~19는 D만(20번은 도착점이지만 완주 전엔 평범한 outer 칸)", () => {
    expect(sidesOf({ kind: "outer", index: 16 })).toEqual(["D"]);
    expect(sidesOf({ kind: "outer", index: 19 })).toEqual(["D"]);
  });

  it("꼭짓점(5/10/15/20)은 인접한 두 변 + 그 꼭짓점을 지나는 대각선까지 3개 줄에 속한다(2026-09-04 확장)", () => {
    expect(sidesOf({ kind: "outer", index: 5 })).toEqual(["A", "B", "diag5-15"]);
    expect(sidesOf({ kind: "outer", index: 10 })).toEqual(["B", "C", "diag10-20"]);
    expect(sidesOf({ kind: "outer", index: 15 })).toEqual(["C", "D", "diag5-15"]);
    expect(sidesOf({ kind: "outer", index: 20 })).toEqual(["D", "A", "diag10-20"]); // 20은 시작점(A)과 물리적으로 같은 모서리
  });

  it("중앙은 두 대각선 모두에 속한다(exitVia와 무관, 2026-09-04 확장)", () => {
    expect(sidesOf({ kind: "center", exitVia: "finish" })).toEqual(["diag5-15", "diag10-20"]);
    expect(sidesOf({ kind: "center", exitVia: "cross" })).toEqual(["diag5-15", "diag10-20"]);
  });

  it("지름길 중간칸은 물리적으로 놓인 대각선 하나에 속한다(2026-09-04 확장)", () => {
    expect(sidesOf({ kind: "shortcutIn", junction: 5, step: 1 })).toEqual(["diag5-15"]);
    expect(sidesOf({ kind: "shortcutIn", junction: 10, step: 2 })).toEqual(["diag10-20"]);
    expect(sidesOf({ kind: "shortcutOut", step: 1 })).toEqual(["diag10-20"]);
    expect(sidesOf({ kind: "shortcutCross", step: 2 })).toEqual(["diag5-15"]);
  });

  it("start/finished는 어느 줄에도 속하지 않는다", () => {
    expect(sidesOf({ kind: "start" })).toEqual([]);
    expect(sidesOf({ kind: "finished" })).toEqual([]);
  });
});

describe("sameSide", () => {
  it("같은 변이면 true", () => {
    expect(sameSide({ kind: "outer", index: 2 }, { kind: "outer", index: 4 })).toBe(true);
  });

  it("서로 인접하지 않은 변이면 false", () => {
    expect(sameSide({ kind: "outer", index: 2 }, { kind: "outer", index: 12 })).toBe(false);
  });

  it("꼭짓점을 사이에 두고 인접한 변끼리는 true(2026-09-04 확장 — 꼭짓점이 두 변에 걸쳐 있음)", () => {
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "outer", index: 6 })).toBe(true); // 5(A/B 꼭짓점)와 B
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "outer", index: 4 })).toBe(true); // 5와 A
  });

  it("꼭짓점과 그 대각선 위 칸은 true(2026-09-04 확장)", () => {
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "outer", index: 15 })).toBe(true); // 5↔15 대각선의 양 끝
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "center", exitVia: "cross" })).toBe(true);
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "shortcutIn", junction: 5, step: 1 })).toBe(true);
    expect(sameSide({ kind: "outer", index: 10 }, { kind: "shortcutOut", step: 1 })).toBe(true);
  });

  it("변 중간 칸은 그 변과 무관한 대각선 위 칸과는 여전히 false", () => {
    expect(sameSide({ kind: "outer", index: 7 }, { kind: "shortcutCross", step: 1 })).toBe(false); // B변 vs 5↔15 대각선
  });

  it("둘 중 하나라도 줄이 없으면(start/finished) false", () => {
    expect(sameSide({ kind: "start" }, { kind: "outer", index: 3 })).toBe(false);
    expect(sameSide({ kind: "finished" }, { kind: "start" })).toBe(false);
  });
});
