import { useState, type FormEvent } from "react";
import { setStoredNickname } from "../game/nickname";
import styles from "./NicknameGate.module.css";

export function NicknameGate({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setStoredNickname(trimmed);
    onDone(trimmed);
  }

  return (
    <div className={styles.wrap}>
      <h2>닉네임을 입력하세요</h2>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={12}
          placeholder="닉네임"
          autoFocus
        />
        <button type="submit">시작하기</button>
      </form>
    </div>
  );
}
