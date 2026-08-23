// client/src/components/YutStaticSticks.tsx
import styles from "./YutStaticSticks.module.css";

/** 내 턴이고 아직 던지기 전(gaugePhase==="idle")일 때 보드 중앙에 보여줄 정지 상태 윷가락 4개. */
export function YutStaticSticks() {
  return (
    <div className={styles.wrap}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className={`${styles.stick} ${i === 0 ? styles.marked : ""}`} />
      ))}
    </div>
  );
}
