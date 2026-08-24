import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";
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

    const unsubscribe = room.onMessage<PieceMovedMessage>("pieceMoved", ({ pieceIds, steps, useShortcut }) => {
      for (const pieceId of pieceIds) {
        const piece = room.state.pieces.find((p) => p.id === pieceId);
        if (!piece) continue;

        const fromCoords = positionToCoords(piece.previousPositionKind, piece.previousPositionIndex);

        const path =
          steps < 0
            ? // 빽도 — 중간 칸 없이 단일 홉으로 previousPosition에서 최종 위치로 직행
              [positionToCoords(piece.positionKind, piece.positionIndex)].filter((c): c is Coords => c !== null)
            : computeMovePath(
                { kind: piece.previousPositionKind, index: piece.previousPositionIndex },
                steps,
                useShortcut,
              )
                .map((p) => positionToCoords(p.kind, p.index))
                .filter((c): c is Coords => c !== null);
        if (path.length === 0) continue; // 도착 좌표조차 없는 경우(예: 빽도로 다시 start行)는 스냅

        // 출발(start)처럼 보드 위 좌표가 없는 위치에서 나가는 이동은 "어디서 왔는지" 보여줄
        // 좌표가 아예 없다 — 그 첫 홉만 트랜지션 없이 즉시 그 자리에 나타나는 것으로 처리하고
        // (막 대기 칸에서 등장하는 자연스러운 연출), 이후 홉부터는 정상적으로 애니메이션한다.
        // 예전에는 이 경우 전체를 건너뛰어(continue) 대기 중이던 말의 첫 이동(걸/개/윷/모처럼
        // 2칸 이상)이 통째로 순간이동해버렸다.
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
    });

    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [room]);

  return overrides;
}
