import { describe, expect, it } from "vitest";
import { moveBackward, moveForward, type Position } from "./position";

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

  it("지름길 모서리(5번)에서 지름길로 1칸 이동하면 중앙에 도착한다", () => {
    const result = moveForward({ kind: "outer", index: 5 }, 1, true);
    expect(result).toEqual({ kind: "center" });
  });

  it("지름길 모서리(10번)에서 지름길로 2칸 이상 이동하면 바로 완주한다", () => {
    const result = moveForward({ kind: "outer", index: 10 }, 2, true);
    expect(result).toEqual({ kind: "finished" });
  });

  it("중앙에서는 몇 칸을 던지든 항상 완주한다", () => {
    expect(moveForward({ kind: "center" }, 1, false)).toEqual({ kind: "finished" });
    expect(moveForward({ kind: "center" }, 5, true)).toEqual({ kind: "finished" });
  });

  it("완주한 말을 다시 이동시키려 하면 에러", () => {
    expect(() => moveForward({ kind: "finished" }, 1, false)).toThrow();
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
});
