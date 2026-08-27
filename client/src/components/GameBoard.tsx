// client/src/components/GameBoard.tsx
import { useEffect, useRef, useState, type PointerEvent, type CSSProperties } from "react";
import type { Room } from "colyseus.js";
import { positionToCoords, CORNERS, CENTER, OUTER_INDICES, JUNCTION_CORNER } from "../game/boardCoords";
import type { MatchState, PieceState, PositionKind } from "../game/matchTypes";
import { useAbilityBubbles } from "../game/useAbilityBubbles";
import { HOP_MS, usePieceAnimations } from "../game/usePieceAnimations";
import { computeMoveDestinations } from "../game/moveDestinations";
import { PieceToken } from "./PieceToken";
import { TurnPanel } from "./TurnPanel";
import styles from "./GameBoard.module.css";

function groupKey(piece: PieceState): string {
  return `${piece.positionKind}:${piece.positionIndex}`;
}

/** 지름길 대각선(5/10/15번 진입 + 중앙→출발점 진출) 위의 중간칸 좌표 — 외곽 칸과 동일한 점
 * 마커로 그린다. 15번은 2026-08-27부터 실제 이동 로직에서는 지름길로 꺾이지 않지만(완주에서
 * 오히려 손해라 useShortcut이 항상 무시됨, position.ts의 SHORTCUT_JUNCTIONS 참고), 보드 판
 * 자체의 생김새(대각선 칸)는 5번/10번과 동일하게 그대로 유지한다 — 사용자가 "칸을 없애달라고는
 * 안 했다"고 명시적으로 되돌려달라고 함(2026-08-27). shortcutIn15 상태는 게임 중엔 도달하지
 * 않지만, 이 점들은 순수 장식용 보드 좌표라 그와 무관하게 그려도 된다. */
const SHORTCUT_DOTS: { key: string; kind: PositionKind; index: number }[] = [
  ...([5, 10, 15] as const).flatMap((junction) =>
    ([1, 2] as const).map((step) => ({
      key: `shortcutIn${junction}-${step}`,
      kind: `shortcutIn${junction}` as PositionKind,
      index: step,
    })),
  ),
  ...([1, 2] as const).map((step) => ({ key: `shortcutOut-${step}`, kind: "shortcutOut" as PositionKind, index: step })),
];

/** 윷/모 체인 중(이동 없이 즉시 재던지기 가능해진 idle 상태) 결과 애니메이션을 강제로 보여주는 시간. */
const CHAIN_ANIM_MS = 1500;

export function GameBoard({
  room,
  selectedPieceId,
  onSelectPiece,
}: {
  room: Room<MatchState>;
  /** 지금 선택된 내 말 — 이 말이 쌓인 패로 갈 수 있는 도착 칸들이 파란 점으로 뜬다. */
  selectedPieceId: string | null;
  onSelectPiece: (pieceId: string | null) => void;
}) {
  const [chargeStartedAt, setChargeStartedAt] = useState(0);
  const isChargingRef = useRef(false);
  const abilityBubbles = useAbilityBubbles(room);
  const pieceAnimations = usePieceAnimations(room);

  // 윷/모가 나오면 서버는 이동 없이 곧바로 gaugePhase를 idle로 되돌려 즉시 재던지기를 허용한다
  // (연속 던지기 규칙) — 그대로 두면 방금 던진 결과의 윷가락 애니메이션을 볼 틈도 없이 "보드를
  // 꾹 누르고" 상태로 바로 넘어간다. 이 state는 그 순간을 감지해서 잠깐(CHAIN_ANIM_MS) 애니메이션을
  // 강제로 보여주고, 그동안 다음 던지기 입력을 막는다. gaugePhase==="idle"이면서 lastThrowResult가
  // 비어있지 않은 조합은 오직 "방금 체인됐다"는 뜻이다 — 턴이 진짜로 넘어갈 때는 lastThrowResult가
  // 함께 비워지므로 최초 idle 상태(턴 시작)와 헷갈릴 일이 없다.
  const [chainAnimatingResult, setChainAnimatingResult] = useState<string | null>(null);
  const lastHandledThrowStartAt = useRef(0);

  useEffect(() => {
    const isChainReady = room.state.gaugePhase === "idle" && room.state.lastThrowResult !== "";
    if (!isChainReady) {
      // 체인 조건이 아니게 됐다면(턴이 실제로 다음 사람에게 넘어간 경우 등) 항상 정리한다.
      // 예전엔 여기서 그냥 return만 해서, 체인 애니메이션이 뜬 지 CHAIN_ANIM_MS가 채 지나기
      // 전에 턴이 넘어가면 — 이 effect가 다시 실행되며 클린업이 아직 안 끝난 타이머를 지워
      // 버리지만 그 타이머가 하려던 "null로 되돌리기"를 대신해주는 코드가 없어서
      // chainAnimatingResult가 영원히 그 값에 멈춰버렸다. 다음 차례 플레이어 화면에 상대의
      // 마지막 체인 결과 화면이 계속 떠서 던지기 자체가 막히는 버그의 원인이었다.
      setChainAnimatingResult(null);
      return;
    }
    if (room.state.throwStartAt === lastHandledThrowStartAt.current) return;
    lastHandledThrowStartAt.current = room.state.throwStartAt;
    setChainAnimatingResult(room.state.lastThrowResult);
    const timer = setTimeout(() => setChainAnimatingResult(null), CHAIN_ANIM_MS);
    return () => clearTimeout(timer);
  }, [room.state.gaugePhase, room.state.lastThrowResult, room.state.throwStartAt]);

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    // 말 이동 버튼/지름길 체크박스는 .centerOverlay 안에서 pointer-events: auto로 뚫려 있어
    // 클릭이 여기까지 버블링된다 — 그 클릭을 보드 전체의 던지기 트리거로 오인하지 않도록 가드.
    if ((e.target as HTMLElement).closest("button, input, label")) return;
    if (room.state.gaugePhase !== "idle") return;
    if (chainAnimatingResult !== null) return; // 체인 애니메이션 보여주는 동안은 다음 던지기를 막는다
    const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
    if (currentSessionId !== room.sessionId) return;
    setChargeStartedAt(Date.now());
    isChargingRef.current = true;
    room.send("throwStart", {});
    // 포인터를 보드 루트에 캡처해둔다 — GameBoard는 게임 내내 계속 마운트돼 있으므로
    // (docs/TROUBLESHOOTING.md #9와 달리) gaugePhase 전환 중 이 노드 자체가 사라질 일이 없다.
    // throwStart 전송 뒤에 시도해서, 캡처 실패가 던지기 등록 자체를 막지 않게 한다.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 무시 — 캡처 성공 여부와 무관하게 서버에는 이미 던지기가 등록됐다.
    }
  }

  function handlePointerUp() {
    if (!isChargingRef.current) return;
    isChargingRef.current = false;
    room.send("throwRelease", {});
  }

  // 말/도착지 파란 점을 제외한 보드 빈 공간을 클릭하면 선택을 취소한다 — 말/도착지 자체의
  // onClick은 stopPropagation으로 이 핸들러까지 안 올라오게 막는다.
  function handleBoardClick() {
    if (room.state.gaugePhase === "resolved") onSelectPiece(null);
  }

  const currentSessionId = room.state.turnOrder[room.state.currentTurnIndex];
  const canSelectPieces = currentSessionId === room.sessionId && room.state.gaugePhase === "resolved";
  const selectedPiece =
    canSelectPieces && selectedPieceId
      ? room.state.pieces.find((p) => p.id === selectedPieceId && p.ownerSessionId === room.sessionId)
      : undefined;
  const destinations = selectedPiece ? computeMoveDestinations(selectedPiece, room.state.pendingResults) : [];

  function selectFromGroup(group: PieceState[]) {
    if (!canSelectPieces) return;
    const mine = group.find((p) => p.ownerSessionId === room.sessionId);
    if (!mine) return;
    onSelectPiece(mine.id === selectedPieceId ? null : mine.id);
  }

  // 애니메이션 중인 말은 최종 상태가 "start"/"finished"라도(캡처로 시작점 복귀, 방금 완주 등)
  // 애니메이션이 끝날 때까지는 계속 그려야 자연스럽다.
  const onBoardPieces = Array.from(room.state.pieces).filter(
    (p) => (p.positionKind !== "start" && p.positionKind !== "finished") || pieceAnimations[p.id],
  );

  // 이동 애니메이션 중인 말은 positionKind/Index가 아니라 pieceId로 안정적인 key를 줘야
  // CSS transition이 "칸 사이를 미끄러지듯" 동작한다(그룹 key가 바뀌면 React가 새 엘리먼트로
  // 취급해서 transition이 끊긴다) — 그래서 정적인 말들과 분리해서 각각 개별 렌더링한다.
  const staticPieces = onBoardPieces.filter((p) => !pieceAnimations[p.id]);
  const animatingPieces = onBoardPieces.filter((p) => pieceAnimations[p.id]);

  const groups = new Map<string, PieceState[]>();
  for (const piece of staticPieces) {
    const key = groupKey(piece);
    const existing = groups.get(key);
    if (existing) {
      existing.push(piece);
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
      onClick={handleBoardClick}
    >
      <svg className={styles.backdrop} viewBox="0 0 100 100">
        <rect
          x={CORNERS[2].x}
          y={CORNERS[1].y}
          width={CORNERS[1].x - CORNERS[2].x}
          height={CORNERS[3].y - CORNERS[1].y}
          className={styles.track}
        />
        {/* 15번은 실제 이동 로직에서는 더 이상 지름길로 꺾이지 않지만(2026-08-27), 보드 판
            생김새는 5번/10번과 동일하게 대각선을 그대로 그린다 — 사용자 명시 요청. */}
        {[5, 10, 15].map((junction) => {
          const corner = CORNERS[JUNCTION_CORNER[junction as 5 | 10 | 15]];
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
        {SHORTCUT_DOTS.map(({ key, kind, index }) => {
          const c = positionToCoords(kind, index);
          if (!c) return null;
          return <circle key={key} cx={c.x} cy={c.y} r={3} className={styles.cellDot} />;
        })}
        {CORNERS.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={4} className={styles.cornerDot} />
        ))}
        <circle cx={CENTER.x} cy={CENTER.y} r={3.5} className={styles.centerDot} />
      </svg>

      <div className={styles.pieceLayer}>
        {Array.from(groups.entries()).map(([key, group]) => {
          const coords = positionToCoords(group[0].positionKind, group[0].positionIndex);
          if (!coords) return null;
          const selectable = canSelectPieces && group.some((p) => p.ownerSessionId === room.sessionId);
          return (
            <div
              key={key}
              className={`${styles.stack} ${selectable ? styles.stackSelectable : ""}`}
              style={{ left: `${coords.x}%`, top: `${coords.y}%` }}
              onClick={
                selectable
                  ? (e) => {
                      e.stopPropagation();
                      selectFromGroup(group);
                    }
                  : undefined
              }
            >
              {group.map((piece, i) => {
                const owner = room.state.players.get(piece.ownerSessionId);
                return (
                  <div
                    key={piece.id}
                    className={`${styles.stackItem} ${piece.id === selectedPieceId ? styles.stackItemSelected : ""}`}
                    style={{ "--i": i } as CSSProperties}
                  >
                    <PieceToken character={piece.character} team={owner?.team ?? ""} size="board" />
                  </div>
                );
              })}
            </div>
          );
        })}
        {animatingPieces.map((piece) => {
          const coords = pieceAnimations[piece.id];
          if (!coords) return null;
          const owner = room.state.players.get(piece.ownerSessionId);
          return (
            <div
              key={piece.id}
              className={styles.stack}
              style={{
                left: `${coords.x}%`,
                top: `${coords.y}%`,
                transition: `left ${HOP_MS}ms linear, top ${HOP_MS}ms linear`,
              }}
            >
              <div className={styles.stackItem} style={{ "--i": 0 } as CSSProperties}>
                <PieceToken character={piece.character} team={owner?.team ?? ""} size="board" />
              </div>
            </div>
          );
        })}
      </div>

      {selectedPiece && (
        <div className={styles.pieceLayer}>
          {destinations.map((d, i) => (
            <div
              key={`${d.resultId}-${d.useShortcut}-${i}`}
              className={styles.destinationDot}
              style={{ left: `${d.coords.x}%`, top: `${d.coords.y}%` }}
              onClick={(e) => {
                e.stopPropagation();
                room.send("movePiece", { pieceId: selectedPiece.id, resultId: d.resultId, useShortcut: d.useShortcut });
                onSelectPiece(null);
              }}
            />
          ))}
        </div>
      )}

      <div className={styles.pieceLayer}>
        {Object.entries(abilityBubbles).map(([pieceId, text]) => {
          const piece = room.state.pieces.find((p) => p.id === pieceId);
          if (!piece) return null;
          const coords = positionToCoords(piece.positionKind, piece.positionIndex);
          if (!coords) return null;
          return (
            <div key={pieceId} className={styles.abilityBubble} style={{ left: `${coords.x}%`, top: `${coords.y}%` }}>
              {text}
            </div>
          );
        })}
      </div>

      <div className={styles.centerOverlay}>
        <TurnPanel room={room} chargeStartedAt={chargeStartedAt} chainAnimatingResult={chainAnimatingResult} />
      </div>
    </div>
  );
}
