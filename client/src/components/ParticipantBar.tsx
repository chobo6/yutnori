import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { useChatBubbles } from "../game/useChatBubbles";
import styles from "./ParticipantBar.module.css";

/**
 * 대기실/플레이/종료 단계와 무관하게 항상 보이는 공통 참가자 바.
 * REQUIREMENTS.md §8의 "채팅을 치면 유저 프로필 쪽에 말풍선"이 뜰 자리 — 지금 화면 구조에는
 * 단계별로 고정된 "프로필" 요소가 없어서, 이 바를 그 역할로 새로 만들었다.
 */
export function ParticipantBar({ room }: { room: Room<MatchState> }) {
  const bubbles = useChatBubbles(room);
  const players = Array.from(room.state.players.values());

  return (
    <div className={styles.bar}>
      {players.map((player) => (
        <div key={player.sessionId} className={styles.slot}>
          {bubbles[player.sessionId] && <div className={styles.bubble}>{bubbles[player.sessionId]}</div>}
          <div className={styles.avatar}>{playerLabel(player.sessionId, room)}</div>
        </div>
      ))}
    </div>
  );
}
