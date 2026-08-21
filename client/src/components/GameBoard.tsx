import type { Room } from "colyseus.js";
import { SHORTCUT_JUNCTION_INDICES, type MatchState, type PieceState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./GameBoard.module.css";

const OUTER_INDICES = Array.from({ length: 19 }, (_, i) => i + 1);

function PieceToken({ piece, room }: { piece: PieceState; room: Room<MatchState> }) {
  const owner = room.state.players.get(piece.ownerSessionId);
  const teamClass = owner?.team === "A" ? styles.teamA : owner?.team === "B" ? styles.teamB : undefined;
  return (
    <span className={`${styles.token} ${teamClass ?? ""}`} title={playerLabel(piece.ownerSessionId, room)}>
      {playerLabel(piece.ownerSessionId, room).slice(0, 2)}
    </span>
  );
}

export function GameBoard({ room }: { room: Room<MatchState> }) {
  const pieces = Array.from(room.state.pieces);
  const players = Array.from(room.state.players.values());

  const piecesAtOuter = (index: number) => pieces.filter((p) => p.positionKind === "outer" && p.positionIndex === index);
  const piecesAtCenter = pieces.filter((p) => p.positionKind === "center");
  const piecesInTray = (sessionId: string, kind: "start" | "finished") =>
    pieces.filter((p) => p.ownerSessionId === sessionId && p.positionKind === kind);

  return (
    <div className={styles.wrap}>
      <h3>보드</h3>
      <div className={styles.outerRow}>
        {OUTER_INDICES.map((index) => (
          <div key={index} className={styles.cell}>
            <span className={styles.cellLabel}>
              {index}
              {SHORTCUT_JUNCTION_INDICES.has(index) ? "★" : ""}
            </span>
            {piecesAtOuter(index).map((p) => (
              <PieceToken key={p.id} piece={p} room={room} />
            ))}
          </div>
        ))}
      </div>

      <div className={styles.centerCell}>
        <span className={styles.cellLabel}>중앙</span>
        {piecesAtCenter.map((p) => (
          <PieceToken key={p.id} piece={p} room={room} />
        ))}
      </div>

      <div className={styles.trays}>
        {players.map((player) => (
          <div key={player.sessionId} className={styles.tray}>
            <strong>{playerLabel(player.sessionId, room)}</strong>
            <div>
              대기:{" "}
              {piecesInTray(player.sessionId, "start").map((p) => (
                <PieceToken key={p.id} piece={p} room={room} />
              ))}
            </div>
            <div>
              완주:{" "}
              {piecesInTray(player.sessionId, "finished").map((p) => (
                <PieceToken key={p.id} piece={p} room={room} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
