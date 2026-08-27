import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { useChatBubbles } from "../game/useChatBubbles";
import styles from "./ParticipantBar.module.css";

/**
 * 대기실/플레이/종료 단계와 무관하게 항상 보이는 공통 참가자 바.
 * REQUIREMENTS.md §8의 "채팅을 치면 유저 프로필 쪽에 말풍선"이 뜰 자리 — 지금 화면 구조에는
 * 단계별로 고정된 "프로필" 요소가 없어서, 이 바를 그 역할로 새로 만들었다.
 * 2026-08-27: 관전자(spectators)도 같은 자리에 점선 테두리로 구분해서 같이 보여준다 — 채팅
 * 말풍선 표시(useChatBubbles)가 세션ID 기반이라 자연스럽게 재사용된다.
 */
export function ParticipantBar({
  room,
  onLeaveLobby,
}: {
  room: Room<MatchState>;
  onLeaveLobby: () => void;
}) {
  const bubbles = useChatBubbles(room);
  const players = Array.from(room.state.players.values());
  const spectators = Array.from(room.state.spectators.values());

  // 나가기는 대기실에서만 보여준다(요청자 확정) — 플레이 중엔 없고, 종료 화면은 WinnerScreen이
  // 이미 "로비로 돌아가기" 버튼을 따로 갖고 있다.
  function handleLeave() {
    room.leave();
    onLeaveLobby();
  }

  return (
    <div className={styles.bar}>
      {players.map((player) => (
        <div key={player.sessionId} className={styles.slot}>
          {bubbles[player.sessionId] && <div className={styles.bubble}>{bubbles[player.sessionId]}</div>}
          <div className={styles.avatar}>{playerLabel(player.sessionId, room)}</div>
        </div>
      ))}
      {spectators.map((spectator) => (
        <div key={spectator.sessionId} className={styles.slot}>
          {bubbles[spectator.sessionId] && <div className={styles.bubble}>{bubbles[spectator.sessionId]}</div>}
          <div className={styles.spectatorAvatar}>👁 {playerLabel(spectator.sessionId, room)}</div>
        </div>
      ))}
      {/* 플레이 중에는 플레이어에게 나가기 버튼이 필요 없다고 확정됐지만(요청자 지시), 관전자는
          애초에 게임이 시작된 뒤에만 존재해서 그 규칙을 그대로 적용하면 나갈 방법이 아예 없어진다
          — 관전자에게는 단계와 무관하게 항상 보여준다. */}
      {(room.state.phase === "waiting" || room.state.spectators.has(room.sessionId)) && (
        <button type="button" className={styles.leaveButton} onClick={handleLeave}>
          나가기
        </button>
      )}
    </div>
  );
}
