import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function WinnerScreen({
  room,
  onLeaveLobby,
}: {
  room: Room<MatchState>;
  onLeaveLobby: () => void;
}) {
  const winner = room.state.players.get(room.state.winnerSessionId);
  const isPlayer = room.state.players.has(room.sessionId);

  // room.leave() 호출은 App.tsx의 handleLeaveLobby로 중앙화됐다(2026-08-29~) — 이유는
  // ParticipantBar.tsx의 동일 주석 참고.
  function handleLeave() {
    onLeaveLobby();
  }

  // 방을 나가지 않고 같은 방의 대기실로 바로 돌아간다(2026-08-30 추가) — 서버가 phase를
  // "waiting"으로 되돌리면 App.tsx가 자동으로 WaitingRoom을 렌더링한다(room.leave() 없이
  // 상태 변경만으로 화면 전환). 관전자는 대상이 아니라 이 버튼 자체를 보여주지 않는다.
  function handleReturnToWaitingRoom() {
    room.send("returnToWaitingRoom", {});
  }

  return (
    <div>
      <h2>게임 종료</h2>
      <p>
        {playerLabel(room.state.winnerSessionId, room)}
        {winner?.team ? ` (${winner.team}팀)` : ""}의 승리!
      </p>
      {isPlayer && (
        <button type="button" onClick={handleReturnToWaitingRoom}>
          대기실로 돌아가기
        </button>
      )}
      <button type="button" onClick={handleLeave}>
        나가기
      </button>
    </div>
  );
}
