import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/** 화면에 한 번에 들고 있을 채팅 최대 개수 — 오래된 메시지부터 밀어낸다(무한정 쌓이지 않게). */
const MAX_MESSAGES = 200;

export interface ChatLogEntry {
  key: number;
  sessionId: string;
  text: string;
}

/**
 * 서버가 브로드캐스트하는 "chatMessage"를 전부 누적해서 보관하는 훅. 예전 useChatBubbles.ts는
 * 세션ID별로 "지금 떠 있는 말풍선 하나"만 3초간 들고 있다가 지웠는데, 2026-08-29부터 채팅을
 * songpyeon처럼 계속 스크롤해서 볼 수 있는 채팅창으로 바꾸면서 이 훅으로 교체했다 — 메시지를
 * 지우지 않고 그대로 쌓는다(최대 개수만 넘으면 오래된 것부터 버림).
 */
export function useChatLog(room: Room<MatchState>): ChatLogEntry[] {
  const [messages, setMessages] = useState<ChatLogEntry[]>([]);

  useEffect(() => {
    let nextKey = 0;
    const unsubscribe = room.onMessage<{ sessionId: string; text: string }>(
      "chatMessage",
      ({ sessionId, text }) => {
        setMessages((prev) => {
          const next = [...prev, { key: nextKey++, sessionId, text }];
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        });
      },
    );
    return unsubscribe;
  }, [room]);

  return messages;
}
