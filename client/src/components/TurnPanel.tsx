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
 * 결과 연출(체인 직후 재던지기 안내, 던진 결과 윷가락)은 내 턴이 아니어도 항상 보인다
 * (2026-08-29~, 사용자 요청) — 던지는 사람만 보던 결과를 다른 플레이어도 구경할 수 있어야
 * 한다. 다만 게이지 막대(charging 단계, 실시간으로 오르내리는 바늘)는 내 턴일 때만 보여준다
 * — 한 번은 다른 플레이어도 보게 서버 브로드캐스트 시각(room.state.throwStartAt)으로 그려봤지만,
 * 네트워크 지연만큼 실제 서버 판정 시점과 어긋난 바늘 위치를 보여주는 셈이라 "이 위치에서
 * 끊긴 것처럼 보였는데 결과가 다르다"는 혼란만 남고 큰 의미가 없어서(사용자 판단으로) 도로
 * 뺐다 — 구경하는 입장에서는 어차피 조작할 수 없으니 결과만 보여주는 걸로 충분하다.
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

      {/* 게이지 막대는 순수 시각 힌트 — 실제 결과는 서버가 재계산한 값을 따른다. 내 턴일 때만
          보여준다(위 컴포넌트 설명 참고 — 구경하는 입장에게는 조작할 수 없는 실시간 바늘 대신
          결과만 보여주는 게 낫다). */}
      {isMyTurn && room.state.gaugePhase === "charging" && <GaugeBar startedAt={chargeStartedAt} />}

      {room.state.gaugePhase === "resolved" && (
        <div>
          <YutSticks result={room.state.lastThrowResult || null} />
          <p>결과: {pendingResults.map((r) => YUT_RESULT_LABELS[r.result] ?? r.result).join(", ")}</p>
        </div>
      )}
    </div>
  );
}
