import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./ParticipantBar.module.css";

/**
 * 대기실/플레이/종료 단계와 무관하게 항상 보이는 공통 참가자 바(참가자/관전자 아바타 + 나가기).
 * 2026-08-27: 관전자(spectators)도 같은 자리에 점선 테두리로 구분해서 같이 보여준다.
 * 2026-08-29: 채팅은 더 이상 이 바에 말풍선으로 뜨지 않는다 — ChatBox(화면 우하단 고정
 * 채팅창)로 옮겨서, 이 컴포넌트는 순수하게 "누가 있는지 + 나가기"만 담당한다.
 */
export function ParticipantBar({
  room,
  onLeaveLobby,
}: {
  room: Room<MatchState>;
  onLeaveLobby: () => void;
}) {
  const players = Array.from(room.state.players.values());
  const spectators = Array.from(room.state.spectators.values());

  // 나가기는 대기실에서만 보여준다(요청자 확정) — 플레이 중엔 없고, 종료 화면은 WinnerScreen이
  // 이미 "로비로 돌아가기" 버튼을 따로 갖고 있다.
  // room.leave() 호출은 App.tsx의 handleLeaveLobby로 중앙화됐다(2026-08-29~) — 재접속
  // 기능이 room.onLeave를 구독해서 "의도치 않은 끊김"과 "나가기 버튼 클릭"을 구분해야 하는데,
  // 이 함수가 직접 room.leave()를 부르면 그 구분이 App.tsx 밖에서 일어나 놓치게 된다.
  function handleLeave() {
    onLeaveLobby();
  }

  return (
    <div className={styles.bar}>
      {players.map((player) => (
        <div key={player.sessionId} className={styles.avatar}>
          {playerLabel(player.sessionId, room)}
        </div>
      ))}
      {spectators.map((spectator) => (
        <div key={spectator.sessionId} className={styles.spectatorAvatar}>
          👁 {playerLabel(spectator.sessionId, room)}
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
