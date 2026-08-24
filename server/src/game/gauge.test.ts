import { describe, expect, it } from "vitest";
import { resolveThrow, wavePosition } from "./gauge";

describe("wavePosition", () => {
  it("주기의 절반 지점에서 최대값(1)에 가깝다", () => {
    expect(wavePosition(750, 1500)).toBeCloseTo(1, 5);
  });

  it("주기 시작점은 0이다", () => {
    expect(wavePosition(0, 1500)).toBeCloseTo(0, 5);
  });

  it("주기를 넘어가면 다시 반복된다 (왕복 파형)", () => {
    expect(wavePosition(1500, 1500)).toBeCloseTo(0, 5);
    expect(wavePosition(2250, 1500)).toBeCloseTo(1, 5);
  });
});

describe("resolveThrow", () => {
  // 경계: [0,.0625)모 [.0625,.125)윷 [.125,.375)걸 [.375,.75)개 [.75,1.0)도(rng<0.25면 빽도로 재판정)
  // wavePosition은 0->1로 선형 증가하는 구간(전반부, elapsed < cycleMs/2)만 사용해 경계 계산을 쉽게 한다.
  const cycleMs = 1500; // 전반부(0~750ms)가 0~1 선형 구간

  it("파형 0.03 지점(모 구간)이면 모가 나온다", () => {
    const elapsed = 0.03 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("mo");
  });

  it("파형 0.10 지점(윷 구간)이면 윷이 나온다", () => {
    const elapsed = 0.1 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("yut");
  });

  it("파형 0.25 지점(걸 구간)이면 걸이 나온다", () => {
    const elapsed = 0.25 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("geol");
  });

  it("파형 0.5 지점(개 구간)이면 개가 나온다", () => {
    const elapsed = 0.5 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs)).toBe("gae");
  });

  it("도 구간이고 rng<0.25면 빽도가 나온다", () => {
    const elapsed = 0.9 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, () => 0.1)).toBe("backDo");
  });

  it("도 구간이고 rng>=0.25면 도가 나온다", () => {
    const elapsed = 0.9 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, () => 0.5)).toBe("do");
  });

  it("startAtMs와 releaseAtMs의 차이만 판정에 사용한다 (절대 시각 무관)", () => {
    const a = resolveThrow(10_000, 10_000 + 0.03 * (cycleMs / 2), cycleMs);
    const b = resolveThrow(0, 0.03 * (cycleMs / 2), cycleMs);
    expect(a).toBe(b);
  });
});
