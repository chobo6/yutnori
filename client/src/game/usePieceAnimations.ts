import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState, PositionKind } from "./matchTypes";
import { positionToCoords, type Coords } from "./boardCoords";
import { computeMovePath } from "./movePath";

/** 한 칸 이동에 걸리는 시간(ms) — 이 값 간격으로 다음 칸으로 넘어간다. GameBoard.tsx가 이 값과
 * 같은 길이의 CSS transition을 걸어서, 칸에서 칸으로 순간이동하지 않고 부드럽게 미끄러지듯
 * 넘어가도록 맞춘다. */
export const HOP_MS = 150;

interface PieceMovedMessage {
  pieceIds: string[];
  steps: number;
  useShortcut: boolean;
  /** 이동 시작/도착 위치를 서버가 메시지에 직접 실어 보낸다 — room.state.pieces를 읽지 않는다.
   * raw broadcast(이 메시지)가 같은 이동을 반영하는 상태 패치보다 먼저 도착하는 경우가 있어서,
   * previousPosition 같은 상태 필드를 읽으면 아직 패치되지 않은 "그 이전 이동 전" 값을 잘못
   * 읽을 수 있기 때문이다(이미 나온 말이 다시 움직일 때 매번 출발점에서 움직이는 것처럼 보이던
   * 버그의 원인 — server/src/rooms/MatchRoom.ts의 broadcastPieceMoved 주석 참고). */
  fromKind: PositionKind;
  fromIndex: number;
  toKind: PositionKind;
  toIndex: number;
}

/**
 * 서버가 브로드캐스트하는 "pieceMoved"를 받아서, 이동한 말들이 한 칸씩 거쳐가는 애니메이션
 * 좌표를 계산해 반환하는 훅. 반환값은 "지금 애니메이션 중이라 원래 상태 좌표 대신 써야 하는"
 * pieceId -> 좌표 맵이다 — 애니메이션이 끝나면 해당 pieceId가 맵에서 빠지고, 호출부는 그때부터
 * room.state 기준 좌표(이미 최종 위치)를 그대로 쓰면 된다.
 */
export function usePieceAnimations(room: Room<MatchState>): Record<string, Coords> {
  const [overrides, setOverrides] = useState<Record<string, Coords>>({});

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const unsubscribe = room.onMessage<PieceMovedMessage>(
      "pieceMoved",
      ({ pieceIds, steps, useShortcut, fromKind, fromIndex, toKind, toIndex }) => {
        const fromCoords = positionToCoords(fromKind, fromIndex);

        const path =
          steps < 0
            ? // 빽도 — 중간 칸 없이 단일 홉으로 from에서 to(최종 위치)로 직행
              [positionToCoords(toKind, toIndex)].filter((c): c is Coords => c !== null)
            : computeMovePath({ kind: fromKind, index: fromIndex }, steps, useShortcut)
                .map((p) => positionToCoords(p.kind, p.index))
                .filter((c): c is Coords => c !== null);
        if (path.length === 0) return;

        for (const pieceId of pieceIds) {
          // 출발(start)처럼 보드 위 좌표가 없는 위치에서 나가는 이동은 "어디서 왔는지" 보여줄
          // 좌표가 아예 없다 — 그 첫 홉만 트랜지션 없이 즉시 그 자리에 나타나는 것으로 처리하고
          // (막 대기 칸에서 등장하는 자연스러운 연출), 이후 홉부터는 정상적으로 애니메이션한다.
          const initialCoords = fromCoords ?? path[0];
          const remainingPath = fromCoords ? path : path.slice(1);

          setOverrides((prev) => ({ ...prev, [pieceId]: initialCoords }));

          function scheduleClear() {
            const clearTimer = setTimeout(() => {
              setOverrides((prev) => {
                const next = { ...prev };
                delete next[pieceId];
                return next;
              });
            }, HOP_MS);
            timers.push(clearTimer);
          }

          if (remainingPath.length === 0) {
            scheduleClear();
          } else {
            remainingPath.forEach((coords, i) => {
              const timer = setTimeout(
                () => {
                  setOverrides((prev) => ({ ...prev, [pieceId]: coords }));
                  if (i === remainingPath.length - 1) scheduleClear();
                },
                (i + 1) * HOP_MS,
              );
              timers.push(timer);
            });
          }
        }
      },
    );

    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [room]);

  return overrides;
}
