import { useEffect, useState } from "react";
import type { Room, RoomAvailable } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { joinRoom, listRooms } from "../colyseus";
import { CreateRoomModal } from "./CreateRoomModal";
import styles from "./RoomList.module.css";

type RoomMeta = { title: string; mode: "2v2" | "1v1" };

export function RoomList({
  nickname,
  onRoomJoined,
}: {
  nickname: string;
  onRoomJoined: (room: Room<MatchState>) => void;
}) {
  const [rooms, setRooms] = useState<RoomAvailable<RoomMeta>[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const list = await listRooms();
        if (!cancelled) setRooms(list);
      } catch (err) {
        console.error("방 목록 조회 실패", err);
      }
    }
    refresh();
    const interval = setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function handleJoin(roomId: string) {
    if (joiningId) return;
    setJoiningId(roomId);
    try {
      const room = await joinRoom(roomId, nickname);
      onRoomJoined(room);
    } catch (err) {
      console.error("방 입장 실패", err);
      setJoiningId(null);
    }
  }

  return (
    <div className={styles.wrap}>
      <h2>방 목록</h2>
      <button type="button" onClick={() => setShowCreate(true)}>
        방 만들기
      </button>
      {rooms.length === 0 && <p>열린 방이 없습니다. 방을 만들어보세요!</p>}
      {rooms.map((r) => (
        <div key={r.roomId} className={styles.row}>
          <span>
            {r.metadata?.title ?? "이름 없는 방"} ({r.metadata?.mode ?? "2v2"}) — {r.clients}/{r.maxClients}
          </span>
          <button type="button" disabled={joiningId === r.roomId} onClick={() => handleJoin(r.roomId)}>
            {joiningId === r.roomId ? "입장 중..." : "입장"}
          </button>
        </div>
      ))}
      {showCreate && (
        <CreateRoomModal
          nickname={nickname}
          onCreated={onRoomJoined}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
