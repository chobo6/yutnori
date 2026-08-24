// client/src/components/TurnPanel.tsx
import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import {
  SHORTCUT_JUNCTION_INDICES,
  YUT_RESULT_LABELS,
  type MatchState,
  type PendingResultState,
  type PieceState,
} from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { GaugeBar } from "./GaugeBar";
import { YutSticks } from "./YutSticks";
import { YutStaticSticks } from "./YutStaticSticks";

/**
 * pieceId는 `${sessionId}-${i}` 형태 — 순번만 뽑아 1-based로 보여준다.
 * sessionId 자체에 "-"가 들어갈 수 있으므로(예: "8KN-xxxx") 반드시 "마지막" 조각을 쓴다.
 */
function pieceOrdinal(pieceId: string): number {
  return Number(pieceId.split("-").pop() ?? 0) + 1;
}

function positionDescription(piece: PieceState): string {
  switch (piece.positionKind) {
    case "start":
      return "대기중";
    case "outer":
      return `${piece.positionIndex}번 칸`;
    case "shortcutIn5":
      return `5번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn10":
      return `10번 지름길 ${piece.positionIndex}칸`;
    case "shortcutIn15":
      return `15번 지름길 ${piece.positionIndex}칸`;
    case "center":
      return "중앙";
    case "shortcutOut":
      return `중앙 통과 ${piece.positionIndex}칸`;
    case "finished":
      return "완주";
  }
}

/**
 * 던지기 트리거(포인터 캡처)는 더 이상 이 컴포넌트가 아니라 GameBoard의 루트 div가 소유한다
 * (docs/TROUBLESHOOTING.md #9 — 캡처를 쥔 노드가 gaugePhase 전환 중 사라지면 안 됨).
 * 이 컴포넌트는 GameBoard가 넘겨준 chargeStartedAt을 그대로 GaugeBar에 전달하는 순수 표시용이다.
 */
export function TurnPanel({
  room,
  chargeStartedAt,
}: {
  room: Room<MatchState>;
  chargeStartedAt: number;
}) {
  const [, setTick] = useState(0);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));
  const pendingResults = room.state.pendingResults;

  // 쌓인 패 목록이 바뀔 때마다(새로 쌓이거나 하나가 소진되면) 선택이 더 이상 유효하지 않을 수
  // 있다 — 유효하지 않으면 항상 가장 먼저 쌓인 패를 기본 선택으로 되돌린다.
  const selected: PendingResultState | undefined =
    pendingResults.find((r) => r.id === selectedResultId) ?? pendingResults[0];

  function moveMyPiece(pieceId: string, useShortcut: boolean) {
    if (!selected) return;
    room.send("movePiece", { pieceId, resultId: selected.id, useShortcut });
  }

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && (
        <>
          <YutStaticSticks />
          <p>보드를 꾹 누르고 있다가 떼세요</p>
        </>
      )}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {isMyTurn && room.state.gaugePhase === "resolved" && selected && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          {pendingResults.length > 1 && (
            <div>
              <p>사용할 패를 고르세요:</p>
              {pendingResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedResultId(r.id)}
                  disabled={r.id === selected.id}
                >
                  {YUT_RESULT_LABELS[r.result] ?? r.result}
                </button>
              ))}
            </div>
          )}
          <p>결과: {YUT_RESULT_LABELS[selected.result] ?? selected.result}</p>
          <p>이동할 말을 고르세요:</p>
          {Array.from(room.state.pieces)
            .filter((p) => p.ownerSessionId === room.sessionId && p.positionKind !== "finished")
            .map((p) => {
              const atJunction = p.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(p.positionIndex);
              return <PieceMoveButton key={p.id} piece={p} atJunction={atJunction} onMove={moveMyPiece} />;
            })}
        </div>
      )}
    </div>
  );
}

function PieceMoveButton({
  piece,
  atJunction,
  onMove,
}: {
  piece: PieceState;
  atJunction: boolean;
  onMove: (pieceId: string, useShortcut: boolean) => void;
}) {
  const [useShortcut, setUseShortcut] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => onMove(piece.id, useShortcut)}>
        말 {pieceOrdinal(piece.id)} — {positionDescription(piece)}
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
