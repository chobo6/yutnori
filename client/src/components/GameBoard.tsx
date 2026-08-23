// client/src/components/GameBoard.tsx
import { useState, type PointerEvent, type CSSProperties } from "react";
import type { Room } from "colyseus.js";
import { positionToCoords, CORNERS, CENTER, OUTER_INDICES } from "../game/boardCoords";
import type { MatchState, PieceState } from "../game/matchTypes";
import { PieceToken } from "./PieceToken";
import { TurnPanel } from "./TurnPanel";
import styles from "./GameBoard.module.css";

const JUNCTION_CORNER_INDEX: Record<number, number> = { 5: 1, 10: 2, 15: 3 };

function groupKey(piece: PieceState): string {
  return `${piece.positionKind}:${piece.positionIndex}`;
}

export function GameBoard({ room }: { room: Room<MatchState> }) {
  const [chargeStartedAt, setChargeStartedAt] = useState(0);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    if (room.state.gaugePhase !== "idle") return;
    const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    if (currentSessionId !== room.sessionId) return;
    // 포인터를 보드 루트에 캡처해둔다 — GameBoard는 게임 내내 계속 마운트돼 있으므로
    // (docs/TROUBLESHOOTING.md #9와 달리) gaugePhase 전환 중 이 노드 자체가 사라질 일이 없다.
    e.currentTarget.setPointerCapture(e.pointerId);
    setChargeStartedAt(Date.now());
    room.send("throwStart", {});
  }

  function handlePointerUp() {
    room.send("throwRelease", {});
  }

  const onBoardPieces = Array.from(room.state.pieces).filter(
    (p) => p.positionKind !== "start" && p.positionKind !== "finished"
  );

  const groups = new Map<string, PieceState[]>();
  for (const piece of onBoardPieces) {
    const key = groupKey(piece);
    const list = groups.get(key);
    if (list) {
      list.push(piece);
    } else {
      groups.set(key, [piece]);
    }
  }

  return (
    <div
      className={styles.board}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <svg className={styles.backdrop} viewBox="0 0 100 100">
        <rect
          x={CORNERS[2].x}
          y={CORNERS[1].y}
          width={CORNERS[1].x - CORNERS[2].x}
          height={CORNERS[3].y - CORNERS[1].y}
          className={styles.track}
        />
        {[5, 10, 15].map((junction) => {
          const corner = CORNERS[JUNCTION_CORNER_INDEX[junction]];
          return (
            <line
              key={junction}
              x1={corner.x}
              y1={corner.y}
              x2={CENTER.x}
              y2={CENTER.y}
              className={styles.diagonal}
            />
          );
        })}
        <line x1={CENTER.x} y1={CENTER.y} x2={CORNERS[0].x} y2={CORNERS[0].y} className={styles.diagonal} />
        {OUTER_INDICES.map((index) => {
          const c = positionToCoords("outer", index);
          if (!c) return null;
          return <circle key={index} cx={c.x} cy={c.y} r={3} className={styles.cellDot} />;
        })}
        {CORNERS.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={4} className={styles.cornerDot} />
        ))}
        <circle cx={CENTER.x} cy={CENTER.y} r={3.5} className={styles.centerDot} />
      </svg>

      <div className={styles.pieceLayer}>
        {Array.from(groups.entries()).map(([key, group]) => {
          const first = group[0];
          const coords = positionToCoords(first.positionKind, first.positionIndex);
          if (!coords) return null;
          return (
            <div key={key} className={styles.stack} style={{ left: `${coords.x}%`, top: `${coords.y}%` }}>
              {group.map((piece, i) => {
                const owner = room.state.players.get(piece.ownerSessionId);
                return (
                  <div
                    key={piece.id}
                    className={styles.stackItem}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <PieceToken character={piece.character} team={owner?.team ?? ""} size="board" />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className={styles.centerOverlay}>
        <TurnPanel room={room} chargeStartedAt={chargeStartedAt} />
      </div>
    </div>
  );
}
