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

  return (
    <div className={styles.track}>
      {GAUGE_ZONES.map((zone) => {
        const left = cumulative * 100;
        const width = (zone.upperBound - cumulative) * 100;
        cumulative = zone.upperBound;
        return (
          <div
            key={zone.result}
            className={styles.zone}
            style={{ left: `${left}%`, width: `${width}%`, background: zone.color }}
          >
            {zone.label}
          </div>
        );
      })}
      <div className={styles.needle} style={{ left: `${value * 100}%` }} />
    </div>
  );
}
