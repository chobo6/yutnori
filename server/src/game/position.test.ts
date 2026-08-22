import { describe, expect, it } from "vitest";
import { moveBackward, moveForward, sameSide, sideOf, type Position } from "./position";

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

  it("외곽 17번 칸에서 5칸 이동하면(17+5=22, 20 이상) 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 17 }, 5, false);
    expect(result).toEqual({ kind: "finished" });
  });

  it("정확히 20칸째(외곽 19+도 1칸)로 도착해도 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 19 }, 1, false);
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
      expect(result).toEqual({ kind: "center" });
    });

    it("4칸(윷)이면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "outer", index: 10 }, 4, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("5칸(모)이면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "outer", index: 15 }, 5, true);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
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

    it("2단계에서 1칸 더 가면 중앙에 도착한다", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 5, step: 2 }, 1, false);
      expect(result).toEqual({ kind: "center" });
    });

    it("1단계에서 모(5칸)를 가면 중앙과 도착 구간을 다 지나 완주한다(1+5=6)", () => {
      const result = moveForward({ kind: "shortcutIn", junction: 10, step: 1 }, 5, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("useShortcut 인자는 무시된다 — 이미 지름길에 올라탄 상태라 선택지가 없다", () => {
      const withTrue = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, true);
      const withFalse = moveForward({ kind: "shortcutIn", junction: 5, step: 1 }, 1, false);
      expect(withTrue).toEqual(withFalse);
    });
  });

  describe("center에서 계속 진행 (항상 도착 방향으로 자동)", () => {
    it("1칸 가면 shortcutOut 1단계", () => {
      const result = moveForward({ kind: "center" }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 1 });
    });

    it("2칸 가면 shortcutOut 2단계", () => {
      const result = moveForward({ kind: "center" }, 2, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("3칸 이상 가면 완주한다", () => {
      expect(moveForward({ kind: "center" }, 3, false)).toEqual({ kind: "finished" });
      expect(moveForward({ kind: "center" }, 5, true)).toEqual({ kind: "finished" });
    });
  });

  describe("shortcutOut에서 계속 진행", () => {
    it("1단계에서 1칸 더 가면 2단계", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 1, false);
      expect(result).toEqual({ kind: "shortcutOut", step: 2 });
    });

    it("1단계에서 2칸 이상 가면 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 1 }, 2, false);
      expect(result).toEqual({ kind: "finished" });
    });

    it("2단계에서 1칸만 더 가도 완주한다", () => {
      const result = moveForward({ kind: "shortcutOut", step: 2 }, 1, false);
      expect(result).toEqual({ kind: "finished" });
    });
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

describe("sideOf", () => {
  it("outer 1~5는 A", () => {
    expect(sideOf({ kind: "outer", index: 1 })).toBe("A");
    expect(sideOf({ kind: "outer", index: 5 })).toBe("A");
  });

  it("outer 6~10은 B", () => {
    expect(sideOf({ kind: "outer", index: 6 })).toBe("B");
    expect(sideOf({ kind: "outer", index: 10 })).toBe("B");
  });

  it("outer 11~15는 C", () => {
    expect(sideOf({ kind: "outer", index: 11 })).toBe("C");
    expect(sideOf({ kind: "outer", index: 15 })).toBe("C");
  });

  it("outer 16~19는 D", () => {
    expect(sideOf({ kind: "outer", index: 16 })).toBe("D");
    expect(sideOf({ kind: "outer", index: 19 })).toBe("D");
  });

  it("start/center/finished는 어느 변에도 속하지 않는다", () => {
    expect(sideOf({ kind: "start" })).toBeNull();
    expect(sideOf({ kind: "center" })).toBeNull();
    expect(sideOf({ kind: "finished" })).toBeNull();
  });

  it("지름길 중간칸(shortcutIn/shortcutOut)도 어느 변에도 속하지 않는다", () => {
    expect(sideOf({ kind: "shortcutIn", junction: 5, step: 1 })).toBeNull();
    expect(sideOf({ kind: "shortcutOut", step: 1 })).toBeNull();
  });
});

describe("sameSide", () => {
  it("같은 변이면 true", () => {
    expect(sameSide({ kind: "outer", index: 2 }, { kind: "outer", index: 4 })).toBe(true);
  });

  it("다른 변이면 false", () => {
    expect(sameSide({ kind: "outer", index: 5 }, { kind: "outer", index: 6 })).toBe(false);
  });

  it("둘 중 하나라도 변이 없으면(start/center/finished) false", () => {
    expect(sameSide({ kind: "start" }, { kind: "outer", index: 3 })).toBe(false);
    expect(sameSide({ kind: "outer", index: 3 }, { kind: "center" })).toBe(false);
    expect(sameSide({ kind: "finished" }, { kind: "start" })).toBe(false);
  });
});
