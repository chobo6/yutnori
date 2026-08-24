// client/src/components/PlayerCorner.tsx
import type { Room } from "colyseus.js";
import { YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { PieceToken } from "./PieceToken";
import styles from "./PlayerCorner.module.css";

/** 아이콘/점수 없이 닉네임 + 대기 중(positionKind==="start")인 말만 보여준다. 완주한 말은 그냥 사라진다. */
export function PlayerCorner({ room, sessionId }: { room: Room<MatchState>; sessionId: string }) {
  const player = room.state.players.get(sessionId);
  const waiting = Array.from(room.state.pieces).filter(
    (p) => p.ownerSessionId === sessionId && p.positionKind === "start"
  );

  const isCurrentTurn = room.state.turnOrder[room.state.currentTurnIndex] === sessionId;
  const pendingResults = isCurrentTurn ? room.state.pendingResults : [];

  return (
    <div className={styles.card}>
      <span className={styles.nickname}>{playerLabel(sessionId, room)}</span>
      {pendingResults.length > 0 && (
        <div className={styles.pendingRow}>
          {pendingResults.map((r) => (
            <span key={r.id} className={styles.pendingBadge}>
              {YUT_RESULT_LABELS[r.result] ?? r.result}
            </span>
          ))}
        </div>
      )}
      <div className={styles.pieceRow}>
        {waiting.map((p) => (
          <PieceToken key={p.id} character={p.character} team={player?.team ?? ""} size="corner" />
        ))}
      </div>
    </div>
  );
}
