import { useEffect, useState, type PointerEvent } from "react";
import type { Room } from "colyseus.js";
import { SHORTCUT_JUNCTION_INDICES, YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";

export function TurnPanel({ room }: { room: Room<MatchState> }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    // 포인터를 이 버튼에 캡처해둔다 — 안 그러면 누른 채로 버튼 밖으로 손가락/마우스가
    // 벗어난 뒤 뗐을 때 onPointerUp이 아예 발생하지 않아 "누른 채로 영원히 멈춘" 상태가 될 수 있다.
    e.currentTarget.setPointerCapture(e.pointerId);
    room.send("throwStart", {});
  }

  function handlePointerUp() {
    room.send("throwRelease", {});
  }

  function moveMyPiece(pieceId: string, useShortcut: boolean) {
    room.send("movePiece", { pieceId, useShortcut });
  }

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && (
        <button type="button" onPointerDown={handlePointerDown} onPointerUp={handlePointerUp}>
          누르고 있다가 떼서 던지기
        </button>
      )}

      {isMyTurn && room.state.gaugePhase === "charging" && <p>누르고 있는 중...</p>}

      {isMyTurn && room.state.gaugePhase === "resolved" && (
        <div>
          <p>결과: {YUT_RESULT_LABELS[room.state.lastThrowResult] ?? room.state.lastThrowResult}</p>
          <p>이동할 말을 고르세요:</p>
          {Array.from(room.state.pieces)
            .filter((p) => p.ownerSessionId === room.sessionId && p.positionKind !== "finished")
            .map((p) => {
              const atJunction =
                p.positionKind === "center" ||
                (p.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(p.positionIndex));
              return (
                <PieceMoveButton key={p.id} pieceId={p.id} atJunction={atJunction} onMove={moveMyPiece} />
              );
            })}
        </div>
      )}
    </div>
  );
}

function PieceMoveButton({
  pieceId,
  atJunction,
  onMove,
}: {
  pieceId: string;
  atJunction: boolean;
  onMove: (pieceId: string, useShortcut: boolean) => void;
}) {
  const [useShortcut, setUseShortcut] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => onMove(pieceId, useShortcut)}>
        말 이동 ({pieceId.slice(0, 6)})
      </button>
      {atJunction && (
        <label>
          <input type="checkbox" checked={useShortcut} onChange={(e) => setUseShortcut(e.target.checked)} />
          지름길 사용
        </label>
      )}
    </div>
  );
}
