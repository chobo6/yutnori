import { describe, expect, it } from "vitest";
import { resolveThrow, wavePosition } from "./gauge";

/** 매 호출마다 다음 값을 순서대로 반환하는 결정적 rng — 확인 확률/재판정/빽도처럼 resolveThrow가
 * rng()를 여러 번 호출할 수 있는 경우를 정확히 통제하기 위한 헬퍼. 마지막 값을 넘겨 호출하면
 * 마지막 값을 계속 반환한다. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

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
  // 경계(2026-08-25 순서 변경 — 왼쪽 "도"에서 시작해 오른쪽 "모"로 차오른다):
  // [0,.25)도 [.25,.625)개 [.625,.875)걸 [.875,.9375)윷 [.9375,1.0]모
  // wavePosition은 0->1로 선형 증가하는 구간(전반부, elapsed < cycleMs/2)만 사용해 경계 계산을 쉽게 한다.
  const cycleMs = 1500; // 전반부(0~750ms)가 0~1 선형 구간

  // 아래 구간 판정 테스트들은 "확인 확률"에 반드시 성공해야(rng < confirmChance) 재판정 없이
  // 그 구간 그대로 나온다 — 첫 rng() 호출에 0을 줘서 항상 확인 성공시킨다. "도" 구간은 확인
  // 성공 후 빽도 재판정(두 번째 rng() 호출)도 거치므로, 빽도로 새지 않도록 0.5(>=0.25)를 이어 준다.

  it("파형 0.10 지점(도 구간)이면 도가 나온다", () => {
    const elapsed = 0.1 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0, 0.5))).toBe("do");
  });

  it("파형 0.40 지점(개 구간)이면 개가 나온다", () => {
    const elapsed = 0.4 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0))).toBe("gae");
  });

  it("파형 0.75 지점(걸 구간)이면 걸이 나온다", () => {
    const elapsed = 0.75 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0))).toBe("geol");
  });

  it("파형 0.90 지점(윷 구간)이면 윷이 나온다", () => {
    const elapsed = 0.9 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0))).toBe("yut");
  });

  it("파형 0.97 지점(모 구간)이면 모가 나온다", () => {
    const elapsed = 0.97 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0))).toBe("mo");
  });

  it("도 구간에 맞고 확인에 성공해도 rng<0.25면 빽도로 재판정된다", () => {
    const elapsed = 0.1 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0, 0.1))).toBe("backDo");
  });

  it("도 구간에 맞고 확인에 성공하고 rng>=0.25면 도가 나온다", () => {
    const elapsed = 0.1 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0, 0.5))).toBe("do");
  });

  it("startAtMs와 releaseAtMs의 차이만 판정에 사용한다 (절대 시각 무관)", () => {
    const a = resolveThrow(10_000, 10_000 + 0.97 * (cycleMs / 2), cycleMs, sequence(0));
    const b = resolveThrow(0, 0.97 * (cycleMs / 2), cycleMs, sequence(0));
    expect(a).toBe(b);
  });

  // 2026-08-25 신규: 게이지를 정확히 맞춰도 무조건 확정되지 않는다 — 도/개/걸은 70%, 윷/모는
  // 60%로 확정되고, 실패하면 각 패의 비중(ZONES 폭)에 맞는 완전히 새 재판정으로 넘어간다.

  it("도/개/걸 구간은 확인 확률이 70%다 — rng>=0.7이면 확인 실패, 비중대로 재판정된다", () => {
    // 걸(.625~.875) 구간에 맞았지만 확인 rng(0.7)가 임계값(0.7) 이상이라 실패 -> 재판정.
    // 재판정 rng(0.5)는 개 구간(.25~.625) 안이라 최종 결과는 개.
    const elapsed = 0.75 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0.7, 0.5))).toBe("gae");
  });

  it("도/개/걸 구간은 rng<0.7이면 확인 성공해 그대로 확정된다(0.7 임계값 경계 확인)", () => {
    const elapsed = 0.75 * (cycleMs / 2); // 걸 구간
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0.69))).toBe("geol");
  });

  it("윷/모 구간은 확인 확률이 50%다 — 70% 기준이었다면 통과했을 rng(0.65)도 실패로 재판정된다", () => {
    // 윷(.875~.9375) 구간에 맞았고 rng(0.65)는 50% 임계값 이상이라 실패 -> 재판정.
    // 재판정 rng(0.3)는 개 구간(.25~.625) 안이라 최종 결과는 개.
    const elapsed = 0.9 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0.65, 0.3))).toBe("gae");
  });

  it("윷/모 구간은 rng<0.5이면 확인 성공해 그대로 확정된다(0.5 임계값 경계 확인)", () => {
    const elapsed = 0.9 * (cycleMs / 2); // 윷 구간
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0.49))).toBe("yut");
  });

  it("확인 실패로 재판정된 결과가 다시 도라면 빽도 재판정까지 이어진다", () => {
    // 모(.9375~1.0) 구간에 맞았지만 확인(0.9>=0.5) 실패 -> 재판정(0.1)은 도 구간(0~.25) 안 ->
    // 결과가 도이므로 빽도 재판정(세 번째 rng 0.1<0.25)까지 이어져 최종 빽도.
    const elapsed = 0.97 * (cycleMs / 2);
    expect(resolveThrow(0, elapsed, cycleMs, sequence(0.9, 0.1, 0.1))).toBe("backDo");
  });
});
