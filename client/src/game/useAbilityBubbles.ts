import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

const BUBBLE_DURATION_MS = 3000;

interface AbilityTriggered {
  pieceId: string;
  character: string;
}

/**
 * 서버가 브로드캐스트하는 "abilityTriggered"를 받아서, pieceId별로 "현재 떠 있는 능력 이름"을
 * 3초간 유지했다가 자동으로 지우는 훅. useChatBubbles.ts와 동일한 패턴 — 능력 발동도 상태
 * (MatchState)에 저장하지 않는 순수 브로드캐스트라서, 화면에 "지금 떠 있는 것"만 로컬로 들고
 * 있으면 된다.
 */
export function useAbilityBubbles(room: Room<MatchState>): Record<string, string> {
  const [bubbles, setBubbles] = useState<Record<string, string>>({});

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    const unsubscribe = room.onMessage<AbilityTriggered>("abilityTriggered", ({ pieceId, character }) => {
      setBubbles((prev) => ({ ...prev, [pieceId]: `${character} 발동!` }));

      const existingTimer = timers.get(pieceId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        setBubbles((prev) => {
          const next = { ...prev };
          delete next[pieceId];
          return next;
        });
        timers.delete(pieceId);
      }, BUBBLE_DURATION_MS);
      timers.set(pieceId, timer);
    });

    return () => {
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [room]);

  return bubbles;
}
