import { useEffect, useReducer, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch } from "../colyseus";
import type { MatchState } from "./matchTypes";

export type ConnectionStatus = "connecting" | "connected" | "error";

export function useMatchRoom() {
  const [room, setRoom] = useState<Room<MatchState> | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let disposed = false;
    let hasReceivedState = false;

    joinMatch()
      .then((joined) => {
        if (disposed) return;
        // joinOrCreate가 resolve돼도 room.state는 아직 비어있을 수 있어
        // 첫 onStateChange를 받은 뒤에야 connected로 전환한다.
        joined.onStateChange(() => {
          if (!hasReceivedState) {
            hasReceivedState = true;
            setRoom(joined);
            setStatus("connected");
          } else {
            // 이후의 모든 상태 변경(턴 전환, 말 이동 등)마다 리렌더를 강제한다 —
            // room 객체 참조 자체는 안 바뀌므로 setRoom만으로는 리렌더되지 않는다.
            forceRender();
          }
        });
      })
      .catch((err) => {
        console.error("방 연결 실패", err);
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
    };
  }, []);

  return { room, status };
}
