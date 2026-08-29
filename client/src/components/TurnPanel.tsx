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
 * 클릭"으로 변경) — 이 컴포넌트는 현재 gaugePhase에 맞는 안내 문구/윷가락 연출만 보여주는
 * 순수 표시용이다.
 *
 * 게이지/결과 연출은 내 턴이 아니어도 항상 보인다(2026-08-29~, 사용자 요청) — 던지는 사람만
 * 보던 걸 다른 플레이어도 실시간으로 구경할 수 있어야 한다. 다만 게이지 막대의 시작 시각은
 * 내 턴이냐 아니냐로 다른 값을 쓴다: 내가 던지는 중이면 내 로컬 pointerdown 시각
 * (chargeStartedAt, GameBoard가 넘겨줌)을, 남의 턴을 구경할 때는 서버가 브로드캐스트하는
 * room.state.throwStartAt을 쓴다. 처음엔 구경꾼 쪽을 맞추려고 항상 throwStartAt 하나로
 * 통일했었는데, 그러면 던지는 사람 본인도 "클릭 → 서버 도착 → 상태 동기화" 왕복 지연만큼
 * 뒤늦은 시각을 기준으로 게이지가 그려져서 600ms 주기에서는 무시 못 할 오차가 생겨 "눈으로
 * 맞춘 것 같은데 서버 판정은 다르게 나온다"는 문제가 생겼다 — 로컬 시각을 쓰면 그 지연이
 * 서버의 실제 판정(resolveThrow가 쓰는 서버 시각 기준 경과시간)과 거의 상쇄되므로 본인에게는
 * 다시 로컬 시각을 써야 한다.
 */
export function TurnPanel({
  room,
  chargeStartedAt,
  chainAnimatingResult,
}: {
  room: Room<MatchState>;
  /** 내가 던지는 중일 때만 쓰는 로컬(클라이언트) pointerdown 시각. */
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

      {room.state.gaugePhase === "idle" && chainAnimatingResult !== null && (
        <div>
          <YutSticks result={chainAnimatingResult} />
          <p>
            {YUT_RESULT_LABELS[chainAnimatingResult] ?? chainAnimatingResult}!{" "}
            {isMyTurn ? "한 번 더 던질 수 있어요" : "한 번 더 던져요"}
          </p>
        </div>
      )}

      {isMyTurn && room.state.gaugePhase === "idle" && chainAnimatingResult === null && (
        <>
          <YutStaticSticks />
          <p>보드를 꾹 누르고 있다가 떼세요</p>
        </>
      )}

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. 내 턴이면
          정확도를 위해 로컬 시각을, 구경하는 입장이면 서버 브로드캐스트 시각을 기준으로 그린다
          (위 컴포넌트 설명 참고). */}
      {room.state.gaugePhase === "charging" && (
        <GaugeBar startedAt={isMyTurn ? chargeStartedAt : room.state.throwStartAt} />
      )}

      {room.state.gaugePhase === "resolved" && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          <p>결과: {pendingResults.map((r) => YUT_RESULT_LABELS[r.result] ?? r.result).join(", ")}</p>
        </div>
      )}
    </div>
  );
}
