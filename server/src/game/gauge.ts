export type YutResult = "backDo" | "do" | "gae" | "geol" | "yut" | "mo";

export const YUT_STEPS: Record<YutResult, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
};

export const GRANTS_EXTRA_THROW: ReadonlySet<YutResult> = new Set(["yut", "mo"]);

export const DEFAULT_GAUGE_CYCLE_MS = 1500;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. */
export function wavePosition(elapsedMs: number, cycleMs: number): number {
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// REQUIREMENTS.md §5: 모 6.25% / 윷 6.25% / 걸 25% / 개 37.5% / 빽도 6.25% / 도 18.75%
// (빽도는 "도 구간 안의 하위 구간"으로 문서화되어 있으나, 확률적으로는 6구간 평면 조회와 동일하므로
//  단일 조회 테이블로 구현한다 — ARCHITECTURE.md §3 참고)
const ZONES: Array<{ upperBound: number; result: YutResult }> = [
  { upperBound: 0.0625, result: "mo" },
  { upperBound: 0.125, result: "yut" },
  { upperBound: 0.375, result: "geol" },
  { upperBound: 0.75, result: "gae" },
  { upperBound: 0.8125, result: "backDo" },
  { upperBound: 1.0, result: "do" },
];

export function resolveThrow(startAtMs: number, releaseAtMs: number, cycleMs: number = DEFAULT_GAUGE_CYCLE_MS): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound);
  return (zone ?? ZONES[ZONES.length - 1]).result;
}
