// client/src/components/PlayerCorner.tsx
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { PieceToken } from "./PieceToken";
import styles from "./PlayerCorner.module.css";

/** 아이콘/점수 없이 닉네임 + 대기 중(positionKind==="start")인 말만 보여준다. 완주한 말은 그냥 사라진다. */
export function PlayerCorner({ room, sessionId }: { room: Room<MatchState>; sessionId: string }) {
  const player = room.state.players.get(sessionId);
  const waiting = Array.from(room.state.pieces).filter(
    (p) => p.ownerSessionId === sessionId && p.positionKind === "start"
  );

  return (
    <div className={styles.card}>
      <span className={styles.nickname}>{playerLabel(sessionId, room)}</span>
      <div className={styles.pieceRow}>
        {waiting.map((p) => (
          <PieceToken key={p.id} character={p.character} team={player?.team ?? ""} size="corner" />
        ))}
      </div>
    </div>
  );
}
