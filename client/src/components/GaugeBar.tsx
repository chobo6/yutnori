import { useEffect, useRef, useState } from "react";
import { GAUGE_ZONES, wavePosition } from "../game/gaugeWave";
import styles from "./GaugeBar.module.css";

/**
 * 꾹 누르고 있는 동안(gaugePhase === "charging") 보여주는 시각 힌트용 게이지 막대.
 * `startedAt`은 로컬(클라이언트) 기준으로 누르기 시작한 시각 — 실제 결과 판정에는 전혀 관여하지
 * 않고, 오직 이 막대를 애니메이션하기 위한 값이다(서버는 자신의 시계로 별도 재계산한다).
 */
export function GaugeBar({ startedAt }: { startedAt: number }) {
  const [value, setValue] = useState(() => wavePosition(Date.now() - startedAt));
  const frameRef = useRef<number>(0);

  useEffect(() => {
    function tick() {
      setValue(wavePosition(Date.now() - startedAt));
      frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [startedAt]);

  let cumulative = 0;

  // 실제 구간 경계값(GAUGE_ZONES의 upperBound)은 서버 판정과 동일하게 유지해야 하므로 손대지
  // 않는다 — 화면에 "도개걸윷모" 순서로 보이도록 좌우만 뒤집는다(value=0을 오른쪽 끝에,
  // value=1을 왼쪽 끝에 그림). 바늘 위치도 같은 방식으로 뒤집어야 실제 게이지 값과 계속 맞는다.
  return (
    <div className={styles.track}>
      {GAUGE_ZONES.map((zone) => {
        const left = (1 - zone.upperBound) * 100;
        const width = (zone.upperBound - cumulative) * 100;
        cumulative = zone.upperBound;
        return (
          <div
            key={zone.result}
            className={styles.zone}
            style={{ left: `${left}%`, width: `${width}%`, background: zone.color }}
          />
        );
      })}
      <div className={styles.needle} style={{ left: `${(1 - value) * 100}%` }} />
    </div>
  );
}
