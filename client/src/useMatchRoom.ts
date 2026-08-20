import { useEffect, useState } from "react";
import type { Room } from "colyseus.js";
import { joinMatch } from "./colyseus";

type Status = "connecting" | "connected" | "error";

export function useMatchRoom() {
  const [status, setStatus] = useState<Status>("connecting");
  const [room, setRoom] = useState<Room | null>(null);

  useEffect(() => {
    let cancelled = false;

    joinMatch()
      .then((joinedRoom) => {
        if (cancelled) return;
        // joinOrCreate가 resolve돼도 room.state는 아직 비어있을 수 있어
        // 첫 onStateChange를 받은 뒤에야 connected로 전환한다 (songpyeon과 동일한 이유).
        joinedRoom.onStateChange.once(() => {
          if (cancelled) return;
          setRoom(joinedRoom);
          setStatus("connected");
        });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, room };
}
