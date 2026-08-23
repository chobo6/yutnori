import { useEffect, useReducer } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "./matchTypes";

/**
 * 이미 연결된 Room을 받아 상태 변경마다 컴포넌트를 리렌더시키는 훅.
 * "방을 얻는 것"(로비/방 만들기, App.tsx가 담당)과 "얻은 방을 구독하는 것"(이 훅)의
 * 책임을 분리했다 — 예전에는 이 훅이 마운트 시 자동으로 joinMatch()를 호출해 방을
 * 얻는 것까지 함께 했지만, 이제는 로비를 거쳐야 방이 생기므로 그럴 수 없다.
 */
export function useMatchRoom(room: Room<MatchState> | null) {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!room) return;
    let disposed = false;
    const handleStateChange = () => {
      if (disposed) return;
      forceRender();
    };
    room.onStateChange(handleStateChange);
    return () => {
      disposed = true;
      room.onStateChange.remove(handleStateChange);
    };
  }, [room]);
}
