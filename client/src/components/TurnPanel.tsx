// client/src/components/TurnPanel.tsx
import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { YUT_RESULT_LABELS, type MatchState } from "../game/matchTypes";
import { playerLabel } from "../game/playerLabel";
import { GaugeBar } from "./GaugeBar";
import { YutSticks } from "./YutSticks";
import { YutStaticSticks } from "./YutStaticSticks";

/**
 * 던지기 트리거(포인터 캡처)는 더 이상 이 컴포넌트가 아니라 GameBoard의 루트 div가 소유한다
 * (docs/TROUBLESHOOTING.md #9 — 캡처를 쥔 노드가 gaugePhase 전환 중 사라지면 안 됨).
 * 말/도착 칸 선택도 GameBoard(+PlayerCorner)가 보드 위 클릭으로 직접 처리한다(2026-08-25 —
 * "카드 먼저 고르고 말 버튼 리스트에서 고르기" 방식에서 "말 먼저 선택 → 보드 위 파란 점
 * 클릭"으로 변경) — 이 컴포넌트는 GameBoard가 넘겨준 chargeStartedAt을 그대로 GaugeBar에
 * 전달하고, 현재 gaugePhase에 맞는 안내 문구/윷가락 연출만 보여주는 순수 표시용이다.
 */
export function TurnPanel({
  room,
  chargeStartedAt,
  chainAnimatingResult,
}: {
  room: Room<MatchState>;
  chargeStartedAt: number;
  /** 윷/모 체인 직후 짧게 결과 애니메이션을 보여주는 동안의 결과값 — null이면 평소 idle 화면. */
  chainAnimatingResult: string | null;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const isMyTurn = currentSessionId === room.sessionId;
  const remainingSeconds = Math.max(0, Math.ceil((room.state.turnDeadlineAt - Date.now()) / 1000));
  const pendingResults = room.state.pendingResults;

  return (
    <div>
      <h3>{isMyTurn ? "내 턴!" : `${playerLabel(currentSessionId, room)}님의 턴을 기다리는 중`}</h3>
      <p>남은 시간: {remainingSeconds}초</p>

      {isMyTurn && room.state.gaugePhase === "idle" && chainAnimatingResult !== null && (
        <div>
          <YutSticks result={chainAnimatingResult} />
          <p>{YUT_RESULT_LABELS[chainAnimatingResult] ?? chainAnimatingResult}! 한 번 더 던질 수 있어요</p>
        </div>
      )}

      {isMyTurn && room.state.gaugePhase === "idle" && chainAnimatingResult === null && (
        <>
          <YutStaticSticks />
          <p>보드를 꾹 누르고 있다가 떼세요</p>
        </>
      )}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {isMyTurn && room.state.gaugePhase === "resolved" && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          <p>결과: {pendingResults.map((r) => YUT_RESULT_LABELS[r.result] ?? r.result).join(", ")}</p>
        </div>
      )}
    </div>
  );
}
