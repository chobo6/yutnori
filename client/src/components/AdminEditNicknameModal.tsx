import { useState, type FormEvent } from "react";
import styles from "./AdminEditNicknameModal.module.css";

export function AdminEditNicknameModal({
  userId,
  currentNickname,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  userId: number;
  currentNickname: string | null;
  onClose: () => void;
  onSaved: (nickname: string) => void;
  onUnauthorized: () => void;
}) {
  const [value, setValue] = useState(currentNickname ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/nickname`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ nickname: value.trim() }),
      });
      if (res.status === 401) {
        onUnauthorized();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "저장에 실패했습니다.");
      }
      onSaved(value.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3>닉네임 수정 (계정 #{userId})</h3>
        <form onSubmit={handleSubmit}>
          <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={12} autoFocus disabled={saving} />
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.actions}>
            <button type="button" onClick={onClose} disabled={saving}>
              취소
            </button>
            <button type="submit" disabled={saving}>
              저장
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
