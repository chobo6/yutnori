import type { Room } from "colyseus.js";
import { SHORTCUT_JUNCTION_INDICES, type MatchState, type PieceState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import styles from "./GameBoard.module.css";

const OUTER_INDICES = Array.from({ length: 19 }, (_, i) => i + 1);

/**
 * 토큰에 보일 짧은 텍스트를 만든다.
 * playerLabel은 "A팀 나" / "A팀 nCtT" 형태라 앞 2글자만 자르면 전부 "A팀"이 되어
 * 같은 팀 말이 전부 똑같아 보인다. 팀 접두사를 떼어낸 소유자 표시 + 말 순번으로 말마다 구분되게 한다.
 * 예: "나1", "나2", "nC1", "nC2"
 */
function tokenText(piece: PieceState, room: Room<MatchState>): string {
  const label = playerLabel(piece.ownerSessionId, room);
  const ownerPart = label.split(" ").pop() ?? label; // "A팀 nCtT" → "nCtT"
  // sessionId 자체에 "-"가 들어갈 수 있으므로(예: "8KN-xxxx") 반드시 "마지막" 조각을 순번으로 쓴다.
  const ordinal = Number(piece.id.split("-").pop() ?? 0) + 1;
  return `${ownerPart.slice(0, 2)}${ordinal}`;
}

function PieceToken({ piece, room }: { piece: PieceState; room: Room<MatchState> }) {
  const owner = room.state.players.get(piece.ownerSessionId);
  const teamClass = owner?.team === "A" ? styles.teamA : owner?.team === "B" ? styles.teamB : undefined;
  return (
    <span className={`${styles.token} ${teamClass ?? ""}`} title={playerLabel(piece.ownerSessionId, room)}>
      {tokenText(piece, room)}
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
