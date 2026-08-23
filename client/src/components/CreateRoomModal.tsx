import { useState, type FormEvent } from "react";
import type { Room } from "colyseus.js";
import type { MatchState } from "../game/matchTypes";
import { createRoom } from "../colyseus";
import styles from "./CreateRoomModal.module.css";

export function CreateRoomModal({
  nickname,
  onCreated,
  onClose,
}: {
  nickname: string;
  onCreated: (room: Room<MatchState>) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"2v2" | "1v1">("2v2");
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const room = await createRoom(title, mode, nickname);
      onCreated(room);
    } catch (err) {
      console.error("방 생성 실패", err);
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>방 만들기</h3>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={20}
          placeholder="방 제목"
          autoFocus
        />
        <div>
          <label>
            <input type="radio" checked={mode === "2v2"} onChange={() => setMode("2v2")} />
            2v2
          </label>
          <label>
            <input type="radio" checked={mode === "1v1"} onChange={() => setMode("1v1")} />
            1v1
          </label>
        </div>
        <button type="submit" disabled={creating}>
          {creating ? "만드는 중..." : "만들기"}
        </button>
        <button type="button" onClick={onClose}>
          취소
        </button>
      </form>
    </div>
  );
}
