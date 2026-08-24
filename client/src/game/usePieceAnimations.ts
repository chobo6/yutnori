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
        if (!fromCoords) continue; // 시작(start)에서 나가는 등 출발 좌표가 없으면 그냥 즉시 스냅

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
        if (path.length === 0) continue;

        setOverrides((prev) => ({ ...prev, [pieceId]: fromCoords }));
        path.forEach((coords, i) => {
          const timer = setTimeout(
            () => {
              setOverrides((prev) => ({ ...prev, [pieceId]: coords }));
              if (i === path.length - 1) {
                const clearTimer = setTimeout(() => {
                  setOverrides((prev) => {
                    const next = { ...prev };
                    delete next[pieceId];
                    return next;
                  });
                }, HOP_MS);
                timers.push(clearTimer);
              }
            },
            (i + 1) * HOP_MS,
          );
          timers.push(timer);
        });
      }
    });

    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [room]);

  return overrides;
}
