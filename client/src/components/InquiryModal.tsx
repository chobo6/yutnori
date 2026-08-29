import { useState, type FormEvent } from "react";
import styles from "./InquiryModal.module.css";

export function InquiryModal({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title, content }),
      });
      if (!res.ok) throw new Error("전송에 실패했습니다.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "전송에 실패했습니다.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2>문의하기</h2>
        {sent ? (
          <>
            <p>문의가 접수됐어요.</p>
            <button onClick={onClose}>닫기</button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              className={styles.input}
              placeholder="제목"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              autoFocus
            />
            <textarea
              className={styles.textarea}
              placeholder="내용"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              rows={6}
            />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} onClick={onClose} disabled={sending}>
                취소
              </button>
              <button type="submit" className={styles.submitButton} disabled={sending}>
                보내기
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
