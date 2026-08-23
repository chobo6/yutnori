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

  function handleLeave() {
    room.leave();
    onLeaveLobby();
  }

  return (
    <div>
      <h2>게임 종료</h2>
      <p>
        {playerLabel(room.state.winnerSessionId, room)}
        {winner?.team ? ` (${winner.team}팀)` : ""}의 승리!
      </p>
      <button type="button" onClick={handleLeave}>
        로비로 돌아가기
      </button>
    </div>
  );
}
