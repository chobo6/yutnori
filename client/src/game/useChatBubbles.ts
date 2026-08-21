import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

const BUBBLE_DURATION_MS = 3000;

interface ChatMessage {
  sessionId: string;
  text: string;
}

/**
 * 서버가 브로드캐스트하는 "chatMessage"를 받아서, 세션ID별로 "현재 떠 있는 말풍선 텍스트"를
 * 3초간 유지했다가 자동으로 지우는 훅. REQUIREMENTS.md §8 — 채팅은 상태(MatchState)에 저장되지
 * 않고 순수 브로드캐스트라서, 화면에 "지금 떠 있는 것"만 로컬로 들고 있으면 된다.
 */
export function useChatBubbles(room: Room<MatchState>): Record<string, string> {
  const [bubbles, setBubbles] = useState<Record<string, string>>({});

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    // room.onMessage(...)는 colyseus.js 내부적으로 nanoevents를 쓰며, 등록 해제용 함수를
    // 직접 반환한다(room.onStateChange의 .remove(cb) 패턴과는 다르다 — 헷갈리지 말 것).
    const unsubscribe = room.onMessage<ChatMessage>("chatMessage", ({ sessionId, text }) => {
      setBubbles((prev) => ({ ...prev, [sessionId]: text }));

      const existingTimer = timers.get(sessionId);
      if (existingTimer) clearTimeout(existingTimer);

      const timer = setTimeout(() => {
        setBubbles((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
        timers.delete(sessionId);
      }, BUBBLE_DURATION_MS);
      timers.set(sessionId, timer);
    });

    return () => {
      unsubscribe();
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, [room]);

  return bubbles;
}
