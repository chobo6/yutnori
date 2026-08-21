import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function WinnerScreen({ room }: { room: Room<MatchState> }) {
  const winner = room.state.players.get(room.state.winnerSessionId);
  return (
    <div>
      <h2>게임 종료</h2>
      <p>
        {playerLabel(room.state.winnerSessionId, room)}
        {winner?.team ? ` (${winner.team}팀)` : ""}의 승리!
      </p>
    </div>
  );
}
