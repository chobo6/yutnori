// client/src/components/PlayerCorner.tsx
import type { Room } from "colyseus.js";
import { YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { PieceToken } from "./PieceToken";
import styles from "./PlayerCorner.module.css";

/** 아이콘/점수 없이 닉네임 + 대기 중(positionKind==="start")인 말만 보여준다. 완주한 말은 그냥 사라진다. */
export function PlayerCorner({
  room,
  sessionId,
  selectedPieceId,
  onSelectPiece,
}: {
  room: Room<MatchState>;
  sessionId: string;
  /** 지금 선택된 내 말 — GameBoard와 상태를 공유한다(대기 중인 말도 선택 대상이라 App.tsx가 들고 있음). */
  selectedPieceId: string | null;
  onSelectPiece: (pieceId: string | null) => void;
}) {
  const player = room.state.players.get(sessionId);
  const waiting = Array.from(room.state.pieces).filter(
    (p) => p.ownerSessionId === sessionId && p.positionKind === "start"
  );

  const isCurrentTurn = room.state.turnOrder[room.state.currentTurnIndex] === sessionId;
  const pendingResults = isCurrentTurn ? room.state.pendingResults : [];
  // 대기 중인 내 말도 보드 위 말과 똑같이 클릭해서 선택할 수 있어야 한다 — 남의 카드는 당연히 대상이 아님.
  const canSelect = sessionId === room.sessionId && isCurrentTurn && room.state.gaugePhase === "resolved";

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
          <div
            key={p.id}
            className={`${styles.waitingPiece} ${canSelect ? styles.waitingPieceSelectable : ""} ${
              p.id === selectedPieceId ? styles.waitingPieceSelected : ""
            }`}
            onClick={canSelect ? () => onSelectPiece(p.id === selectedPieceId ? null : p.id) : undefined}
          >
            <PieceToken character={p.character} team={player?.team ?? ""} size="corner" />
          </div>
        ))}
      </div>
    </div>
  );
}
