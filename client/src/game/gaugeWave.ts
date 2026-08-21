/**
 * server/src/game/gauge.ts의 파형/구간 계산을 손으로 그대로 미러링한다(공유 타입 패키지가
 * 없는 이 프로젝트의 확립된 관례 — matchTypes.ts와 동일).
 *
 * 이 파일은 순수 시각 연출용이다. 실제 던지기 결과는 항상 서버가 자신의 시계로 재계산한
 * 값을 따르며(ARCHITECTURE.md §2 서버 권위형 원칙), 여기 계산값을 서버 판정 대신 신뢰하면 안 된다.
 */

export const DEFAULT_GAUGE_CYCLE_MS = 1500;

/** elapsedMs를 cycleMs 주기의 삼각파(0->1->0)로 변환한다. server/src/game/gauge.ts의 wavePosition과 동일. */
export function wavePosition(elapsedMs: number, cycleMs: number = DEFAULT_GAUGE_CYCLE_MS): number {
  const t = (((elapsedMs % cycleMs) + cycleMs) % cycleMs) / cycleMs; // 0..1, 음수 elapsed 방어
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

export interface GaugeZone {
  /** matchTypes.ts의 YUT_RESULT_LABELS 키와 동일한 서버 결과 코드. */
  result: string;
  label: string;
  upperBound: number;
  color: string;
}

// server/src/game/gauge.ts의 ZONES와 순서/경계값 동일 (REQUIREMENTS.md §5).
export const GAUGE_ZONES: GaugeZone[] = [
  { result: "mo", label: "모", upperBound: 0.0625, color: "#c0392b" },
  { result: "yut", label: "윷", upperBound: 0.125, color: "#8e44ad" },
  { result: "geol", label: "걸", upperBound: 0.375, color: "#2980b9" },
  { result: "gae", label: "개", upperBound: 0.75, color: "#27ae60" },
  { result: "backDo", label: "빽도", upperBound: 0.8125, color: "#f39c12" },
  { result: "do", label: "도", upperBound: 1.0, color: "#7f8c8d" },
];
