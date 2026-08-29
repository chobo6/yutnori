import { useState, type FormEvent } from "react";
import { submitNickname } from "../game/auth";
import styles from "./NicknameSetupScreen.module.css";

export function NicknameSetupScreen({ onDone }: { onDone: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitNickname(trimmed);
      onDone(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "닉네임 설정에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <h2>닉네임을 설정하세요</h2>
      <p className={styles.hint}>계정에 영구적으로 저장돼요. 이후 변경은 관리자에게 문의해주세요.</p>
      <form onSubmit={handleSubmit}>
        <input
          className={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={12}
          placeholder="닉네임"
          autoFocus
          disabled={submitting}
        />
        <button type="submit" disabled={submitting}>
          시작하기
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
