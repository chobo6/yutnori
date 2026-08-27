import { useEffect, useState } from "react";
import type { Room, RoomAvailable } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { joinRoom, listRooms, type RoomMeta } from "../colyseus";
import { CreateRoomModal } from "./CreateRoomModal";
import styles from "./RoomList.module.css";

/** 방 상태에 따라 목록에 보여줄 버튼 텍스트/비활성 여부를 계산한다 — 2026-08-27 관전 기능. */
function joinButtonState(meta: RoomMeta | undefined): { label: string; disabled: boolean } {
  if (!meta) return { label: "입장", disabled: false };
  if (meta.phase === "waiting") {
    if (meta.playerCount >= meta.playerCapacity) return { label: "가득 참", disabled: true };
    return { label: "입장", disabled: false };
  }
  // phase === "playing" (서버가 이미 "finished"인 방은 목록에서 걸러서 보내준다)
  if (meta.allowSpectators) return { label: "관전하기", disabled: false };
  return { label: "게임 중", disabled: true };
}

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
      {rooms.map((r) => {
        const { label, disabled } = joinButtonState(r.metadata);
        const statusText =
          r.metadata?.phase === "playing"
            ? "진행 중"
            : `${r.metadata?.playerCount ?? 0}/${r.metadata?.playerCapacity ?? "?"}`;
        return (
          <div key={r.roomId} className={styles.row}>
            <span>
              {r.metadata?.title ?? "이름 없는 방"} ({r.metadata?.mode ?? "2v2"}) — {statusText}
            </span>
            <button
              type="button"
              disabled={disabled || joiningId === r.roomId}
              onClick={() => handleJoin(r.roomId)}
            >
              {joiningId === r.roomId ? "입장 중..." : label}
            </button>
          </div>
        );
      })}
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
