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
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [creating, setCreating] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    try {
      const room = await createRoom(title, mode, nickname, allowSpectators);
      onCreated(room);
    } catch (err) {
      console.error("방 생성 실패", err);
      setCreating(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3 className={styles.title}>방 만들기</h3>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>방 제목</span>
          <input
            className={styles.titleInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={20}
            placeholder="이름 없는 방"
            autoFocus
          />
        </label>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>모드</span>
          <div className={styles.modeRow}>
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "2v2" ? styles.modeSelected : ""}`}
              onClick={() => setMode("2v2")}
            >
              2v2
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${mode === "1v1" ? styles.modeSelected : ""}`}
              onClick={() => setMode("1v1")}
            >
              1v1
            </button>
          </div>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            checked={allowSpectators}
            onChange={(e) => setAllowSpectators(e.target.checked)}
          />
          <span>관전 허용</span>
        </label>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.submitButton} disabled={creating}>
            {creating ? "만드는 중..." : "만들기"}
          </button>
        </div>
      </form>
    </div>
  );
}
