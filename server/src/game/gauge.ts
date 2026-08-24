export type YutResult = "backDo" | "do" | "gae" | "geol" | "yut" | "mo";

/** 교주 보너스 전진(§3.1)이 모서리에서 발동해 지름길 선택이 필요할 때 쌓는 합성 대기 패의
 * result 코드 — 실제 윷 던지기 결과가 아니지만, MatchRoom.performMove가 모든 대기 패를
 * YUT_STEPS로 동일하게 처리하므로 같은 테이블에 둔다. */
export const GYOJU_BONUS_RESULT = "gyojuBonus";

export const YUT_STEPS: Record<string, number> = {
  backDo: -1,
  do: 1,
  gae: 2,
  geol: 3,
  yut: 4,
  mo: 5,
  [GYOJU_BONUS_RESULT]: 1,
};

export const GRANTS_EXTRA_THROW: ReadonlySet<YutResult> = new Set(["yut", "mo"]);

export const DEFAULT_GAUGE_CYCLE_MS = 1500;

/** [0, 1) 범위의 난수를 반환하는 함수. 테스트에서 결정적 값을 주입하기 위한 타입 — abilities.ts의 Rng와 동일한 모양. */
export type Rng = () => number;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. */
export function wavePosition(elapsedMs: number, cycleMs: number): number {
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// REQUIREMENTS.md §5: 모 6.25% / 윷 6.25% / 걸 25% / 개 37.5% / 빽도 6.25% / 도 18.75%
// 빽도는 게이지 zone이 아니라 "도" zone에 걸린 뒤 별도의 순수 확률(1/4)로 재판정한다
// (2026-08-24 변경 — 표식 가락이 결정, 타이밍으로 노릴 수 없음). "도" zone 자체는
// 0.75~1.0 전체(25%)를 차지하고, 그중 25%(=전체의 6.25%)가 빽도로 바뀐다.
const ZONES: Array<{ upperBound: number; result: YutResult }> = [
  { upperBound: 0.0625, result: "mo" },
  { upperBound: 0.125, result: "yut" },
  { upperBound: 0.375, result: "geol" },
  { upperBound: 0.75, result: "gae" },
  { upperBound: 1.0, result: "do" },
];

const BACK_DO_CHANCE = 0.25;

export function resolveThrow(
  startAtMs: number,
  releaseAtMs: number,
  cycleMs: number = DEFAULT_GAUGE_CYCLE_MS,
  rng: Rng = Math.random,
): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound) ?? ZONES[ZONES.length - 1];
  if (zone.result === "do" && rng() < BACK_DO_CHANCE) return "backDo";
  return zone.result;
}
