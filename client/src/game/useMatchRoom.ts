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
    let joinedRoom: Room<MatchState> | null = null;
    let handleStateChange: (() => void) | null = null;

    joinMatch()
      .then((joined) => {
        if (disposed) return;
        joinedRoom = joined;
        handleStateChange = () => {
          if (disposed) return;
          // joinOrCreate가 resolve돼도 room.state는 아직 비어있을 수 있어
          // 첫 onStateChange를 받은 뒤에야 connected로 전환한다.
          if (!hasReceivedState) {
            hasReceivedState = true;
            setRoom(joined);
            setStatus("connected");
          } else {
            // 이후의 모든 상태 변경(턴 전환, 말 이동 등)마다 리렌더를 강제한다 —
            // room 객체 참조 자체는 안 바뀌므로 setRoom만으로는 리렌더되지 않는다.
            forceRender();
          }
        };
        joined.onStateChange(handleStateChange);
      })
      .catch((err) => {
        console.error("방 연결 실패", err);
        if (!disposed) setStatus("error");
      });

    return () => {
      disposed = true;
      // 언마운트 시 리스너를 해제하지 않으면 room에 콜백이 계속 붙어있게 되어
      // 이미 사라진 훅 인스턴스를 향해 setRoom/setStatus/forceRender를 계속 호출하게 된다.
      if (joinedRoom && handleStateChange) {
        joinedRoom.onStateChange.remove(handleStateChange);
      }
    };
  }, []);

  return { room, status };
}
