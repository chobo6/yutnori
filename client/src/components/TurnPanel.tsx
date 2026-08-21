import { useEffect, useState, type PointerEvent } from "react";
import type { Room } from "colyseus.js";
import {
  SHORTCUT_JUNCTION_INDICES,
  YUT_RESULT_LABELS,
  type MatchState,
  type PieceState,
} from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { GaugeBar } from "./GaugeBar";
import { YutSticks } from "./YutSticks";

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
    case "center":
      return "중앙";
    case "finished":
      return "완주";
  }
}

export function TurnPanel({ room }: { room: Room<MatchState> }) {
  const [, setTick] = useState(0);
  // 게이지 막대 애니메이션 기준 시각(로컬) — 실제 결과 판정과는 무관, 오직 GaugeBar 연출용.
  const [chargeStartedAt, setChargeStartedAt] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));

  function handlePointerDown(e: PointerEvent<HTMLButtonElement>) {
    // charging 중 들어온 중복 pointerdown은 무시 — throwStart를 다시 보내면 안 된다.
    if (room.state.gaugePhase !== "idle") return;
    // 포인터를 이 버튼에 캡처해둔다 — 안 그러면 누른 채로 버튼 밖으로 손가락/마우스가
    // 벗어난 뒤 뗐을 때 onPointerUp이 아예 발생하지 않아 "누른 채로 영원히 멈춘" 상태가 될 수 있다.
    e.currentTarget.setPointerCapture(e.pointerId);
    setChargeStartedAt(Date.now());
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

      {/*
        idle과 charging 양쪽에서 "같은" button 엘리먼트를 계속 렌더한다.
        서버가 throwStart를 받자마자 gaugePhase를 charging으로 바꾸고 그 변경이 ~50ms 주기 상태 동기화로
        되돌아오는데, 여기서 버튼이 언마운트되면 포인터 캡처가 풀려 pointerup이 사라지고
        throwRelease가 영영 전송되지 않는다(→ 서버 5초 auto-throw로 빠짐).
        따라서 라벨만 phase에 따라 바꾸고 DOM 노드 정체성은 유지한다.
      */}
      {isMyTurn && room.state.gaugePhase !== "resolved" && (
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {room.state.gaugePhase === "charging"
            ? "누르고 있는 중... (떼면 던짐)"
            : "누르고 있다가 떼서 던지기"}
        </button>
      )}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {isMyTurn && room.state.gaugePhase === "resolved" && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          <p>결과: {YUT_RESULT_LABELS[room.state.lastThrowResult] ?? room.state.lastThrowResult}</p>
          <p>이동할 말을 고르세요:</p>
          {Array.from(room.state.pieces)
            .filter((p) => p.ownerSessionId === room.sessionId && p.positionKind !== "finished")
            .map((p) => {
              const atJunction =
                p.positionKind === "center" ||
                (p.positionKind === "outer" && SHORTCUT_JUNCTION_INDICES.has(p.positionIndex));
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
