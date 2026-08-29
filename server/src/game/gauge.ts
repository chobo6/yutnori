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

export const DEFAULT_GAUGE_CYCLE_MS = 600;

/** [0, 1) 범위의 난수를 반환하는 함수. 테스트에서 결정적 값을 주입하기 위한 타입 — abilities.ts의 Rng와 동일한 모양. */
export type Rng = () => number;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. */
export function wavePosition(elapsedMs: number, cycleMs: number): number {
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

// REQUIREMENTS.md §5: 도 25% / 개 37.5% / 걸 25% / 윷 6.25% / 모 6.25%(빽도는 "도" 확정 후
// 별도 재판정이라 여기 비중에 안 잡힘). 게이지는 이제 왼쪽 "도"에서 시작해 오른쪽 "모"
// 쪽으로 차오른다(2026-08-25 변경, 사용자 요청) — 즉 값(value)이 작을수록(누르자마자
// 놓을수록) 도에 가깝고, 값이 클수록(정점 근처까지 오래 눌렀을수록) 모에 가깝다. 순서만
// 뒤집혔을 뿐 각 구간의 폭(=비중)은 그대로다.
const ZONES: Array<{ upperBound: number; result: YutResult }> = [
  { upperBound: 0.25, result: "do" },
  { upperBound: 0.625, result: "gae" },
  { upperBound: 0.875, result: "geol" },
  { upperBound: 0.9375, result: "yut" },
  { upperBound: 1.0, result: "mo" },
];

const BACK_DO_CHANCE = 0.25;

/**
 * 게이지를 정확히 맞춰도 그 구간이 무조건 확정되지 않는다(2026-08-25 도입, 2026-08-29 윷/모
 * 확률 60%→50%로 추가 하향, 둘 다 사용자 요청) — 도/개/걸은 70%, 윷/모는 50%로만 확정되고,
 * 나머지 확률로는 실패해서 각 패가 뜰 확률(=위 ZONES의 폭 비중)에 맞는 완전히 새로운
 * 재판정으로 넘어간다. 타이밍을 정확히 맞추는 의미는 남아있지만(특히 희귀한 윷/모는 절반은
 * 그대로 인정되고 절반은 재판정된다), 절대적인 확정이 아니게 됐다.
 */
const CONFIRM_CHANCE: Record<YutResult, number> = {
  do: 0.7,
  gae: 0.7,
  geol: 0.7,
  yut: 0.5,
  mo: 0.5,
};

/** 위 ZONES의 폭 비중 그대로 새 난수 하나로 결과를 뽑는다 — 확인 확률 실패 시 재판정에 쓴다. */
function weightedRandomResult(rng: Rng): YutResult {
  const value = rng();
  const zone = ZONES.find((z) => value < z.upperBound) ?? ZONES[ZONES.length - 1];
  return zone.result;
}

export function resolveThrow(
  startAtMs: number,
  releaseAtMs: number,
  cycleMs: number = DEFAULT_GAUGE_CYCLE_MS,
  rng: Rng = Math.random,
): YutResult {
  const elapsed = releaseAtMs - startAtMs;
  const value = wavePosition(elapsed, cycleMs);
  const zone = ZONES.find((z) => value < z.upperBound) ?? ZONES[ZONES.length - 1];
  const confirmed = rng() < CONFIRM_CHANCE[zone.result];
  const result = confirmed ? zone.result : weightedRandomResult(rng);
  if (result === "do" && rng() < BACK_DO_CHANCE) return "backDo";
  return result;
}
